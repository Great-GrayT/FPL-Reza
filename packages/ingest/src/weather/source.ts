import {
  groundSchema,
  matchSchema,
  matchWeatherSchema,
  type Ground,
  type Match,
  type MatchWeather,
  type Season,
} from '@fpl/core';
import { HttpClient, type HttpClientOptions } from '../http.js';
import { DATASETS, type Source, type SourceBatch, type SourceContext } from '../source.js';

/**
 * Open-Meteo, which serves both a forecast and a historical archive without a
 * key, an account, or an attribution header. A fixture already carries its
 * ground and a ground carries its coordinates, so no geocoding step exists.
 */
export const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1';
export const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1';

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'wind_speed_10m',
  'relative_humidity_2m',
  'cloud_cover',
  'weather_code',
].join(',');

export function openMeteoHttp(options?: Partial<HttpClientOptions>): HttpClient {
  return new HttpClient({
    baseUrl: OPEN_METEO_FORECAST,
    timeoutMs: 20_000,
    retries: 3,
    minRequestIntervalMs: 250,
    userAgent: 'fpl-platform/0.0.0',
    name: 'open-meteo',
    ...options,
  });
}

interface HourlyBlock {
  time?: string[];
  temperature_2m?: (number | null)[];
  apparent_temperature?: (number | null)[];
  precipitation?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  cloud_cover?: (number | null)[];
  weather_code?: (number | null)[];
}

const isoDay = (at: Date): string => at.toISOString().slice(0, 10);
const isoHour = (at: Date): string => `${at.toISOString().slice(0, 13)}:00`;

/**
 * The forecast endpoint reaches about 16 days ahead and 3 months back; the
 * archive endpoint covers everything older but lags reality by around five
 * days. Choosing between them by the kickoff date is the whole of the logic.
 */
export function endpointFor(kickoff: Date, now: Date): string {
  const daysAgo = (now.getTime() - kickoff.getTime()) / 86_400_000;
  return daysAgo > 60 ? OPEN_METEO_ARCHIVE : OPEN_METEO_FORECAST;
}

export interface WeatherOptions {
  /**
   * Only fetch matches kicking off within this many days either side of now.
   * The forecast reaches about sixteen days ahead and answers anything beyond
   * that with 400, so the default stays inside it rather than spending a
   * request per ground per matchday to be told no.
   */
  windowDays?: number;
  maxRequests?: number;
  now?: Date;
}

/**
 * Conditions at kickoff, one row per match. Requests are grouped by ground and
 * day, because a matchday at one ground is one request no matter how many
 * kickoffs share it.
 */
export function weatherSource(http: HttpClient, options: WeatherOptions = {}): Source {
  const windowDays = options.windowDays ?? 14;

  return {
    name: 'weather-open-meteo',
    datasets: [DATASETS.matchWeather],
    requires: [DATASETS.matches, DATASETS.grounds],

    async *run(context: SourceContext): AsyncIterable<SourceBatch> {
      const now = options.now ?? context.capturedAt;
      const grounds = await context.store.read<Ground>(
        { season: context.season, dataset: DATASETS.grounds },
        groundSchema,
      );
      const byGround = new Map(grounds.map((ground) => [ground.groundId, ground]));

      const partition = (context.season as string).replace('/', '-');
      const matches = await context.store.read<Match>(
        { season: context.season, dataset: DATASETS.matches, partition },
        matchSchema,
      );

      const horizon = windowDays * 86_400_000;
      const wanted = matches.filter(
        (match) =>
          match.kickoff !== null &&
          match.groundId !== null &&
          byGround.has(match.groundId) &&
          Math.abs(match.kickoff.getTime() - now.getTime()) <= horizon,
      );

      // One request per ground per day, then every kickoff that day reads its
      // own hour out of the block.
      const groups = new Map<string, Match[]>();
      for (const match of wanted) {
        if (match.kickoff === null || match.groundId === null) continue;
        const key = `${String(match.groundId)}|${isoDay(match.kickoff)}`;
        const existing = groups.get(key);
        if (existing === undefined) groups.set(key, [match]);
        else existing.push(match);
      }

      const rows: MatchWeather[] = [];
      let requests = 0;

      for (const [key, group] of groups) {
        if (options.maxRequests !== undefined && requests >= options.maxRequests) break;
        const first = group[0];
        if (first?.kickoff === undefined || first.kickoff === null || first.groundId === null) {
          continue;
        }
        const ground = byGround.get(first.groundId);
        if (ground?.latitude == null || ground.longitude == null) continue;

        const day = key.split('|')[1] ?? isoDay(first.kickoff);
        const base = endpointFor(first.kickoff, now);
        requests += 1;

        let hourly: HourlyBlock;
        try {
          const payload = (await http.getJson(
            `${base}/${base === OPEN_METEO_ARCHIVE ? 'archive' : 'forecast'}` +
              `?latitude=${String(ground.latitude)}&longitude=${String(ground.longitude)}` +
              `&hourly=${HOURLY}&start_date=${day}&end_date=${day}&timezone=UTC`,
          )) as { hourly?: HourlyBlock };
          hourly = payload.hourly ?? {};
        } catch (error) {
          context.logger.warn('weather failed', {
            ground: ground.name,
            day,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const times = hourly.time ?? [];
        for (const match of group) {
          if (match.kickoff === null || match.groundId === null) continue;
          const index = times.indexOf(isoHour(match.kickoff));
          if (index === -1) continue;
          const at = (field: keyof HourlyBlock): number | null => {
            const series = hourly[field];
            if (!Array.isArray(series)) return null;
            const value = series[index];
            return typeof value === 'number' ? value : null;
          };

          rows.push(
            matchWeatherSchema.parse({
              matchId: match.matchId,
              season: match.season,
              kickoff: match.kickoff,
              groundId: match.groundId,
              temperatureC: at('temperature_2m'),
              apparentTemperatureC: at('apparent_temperature'),
              precipitationMm: at('precipitation'),
              windSpeedKmh: at('wind_speed_10m'),
              humidityPercent: at('relative_humidity_2m'),
              cloudCoverPercent: at('cloud_cover'),
              weatherCode: at('weather_code'),
            }),
          );
        }
      }

      context.logger.info('weather read', { requests, rows: rows.length });
      if (rows.length > 0) {
        yield {
          dataset: DATASETS.matchWeather,
          partition,
          rows,
          format: 'jsonl',
        };
      }
    },
  };
}

/** Kept for a caller that wants the label without importing the whole source. */
export const weatherPartition = (season: Season): string => (season as string).replace('/', '-');

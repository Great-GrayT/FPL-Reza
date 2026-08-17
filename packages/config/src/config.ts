import { z } from 'zod';
import { LOG_LEVELS, ValidationError, seasonSchema } from '@fpl/core';
import { seasonForDate } from './season.js';

export const configSchema = z.object({
  season: seasonSchema,
  /** Root of the flat file data lake. Every snapshot lands under here. */
  dataDir: z.string().min(1),
  logLevel: z.enum(LOG_LEVELS),
  fpl: z.object({
    baseUrl: z.string().url(),
    timeoutMs: z.number().int().positive(),
    retries: z.number().int().min(0).max(10),
    /** Floor on the gap between requests. FPL throttles aggressive clients. */
    minRequestIntervalMs: z.number().int().min(0),
    userAgent: z.string().min(1),
  }),
});

export type Config = z.infer<typeof configSchema>;

export type Env = Readonly<Partial<Record<string, string>>>;

const DEFAULTS = {
  dataDir: 'data',
  logLevel: 'info',
  baseUrl: 'https://fantasy.premierleague.com/api',
  timeoutMs: 15_000,
  retries: 3,
  minRequestIntervalMs: 250,
  userAgent: 'fpl-platform/0.0.0 (+https://github.com/local/fpl)',
} as const;

const int = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ValidationError(`expected an integer, got "${value}"`);
  }
  return parsed;
};

/**
 * Config is read once at process start. Failure is fatal by design: a half
 * configured ingest run writes snapshots to the wrong place.
 */
export function loadConfig(env: Env = process.env, now: Date = new Date()): Config {
  const candidate = {
    season: env['FPL_SEASON'] ?? seasonForDate(now),
    dataDir: env['FPL_DATA_DIR'] ?? DEFAULTS.dataDir,
    logLevel: env['FPL_LOG_LEVEL'] ?? DEFAULTS.logLevel,
    fpl: {
      baseUrl: env['FPL_BASE_URL'] ?? DEFAULTS.baseUrl,
      timeoutMs: int(env['FPL_TIMEOUT_MS'], DEFAULTS.timeoutMs),
      retries: int(env['FPL_RETRIES'], DEFAULTS.retries),
      minRequestIntervalMs: int(env['FPL_MIN_REQUEST_INTERVAL_MS'], DEFAULTS.minRequestIntervalMs),
      userAgent: env['FPL_USER_AGENT'] ?? DEFAULTS.userAgent,
    },
  };

  const result = configSchema.safeParse(candidate);
  if (!result.success) {
    throw new ValidationError(
      'invalid configuration',
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

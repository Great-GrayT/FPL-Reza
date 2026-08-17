export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  /** Injected so tests can capture output instead of writing to stderr. */
  sink?: (line: string) => void;
  base?: LogFields;
}

/**
 * Line oriented logger. Writes to stderr so stdout stays clean for CLI output
 * that another tool might pipe.
 */
export function createLogger(options: ConsoleLoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink =
    options.sink ??
    ((line: string): void => {
      process.stderr.write(`${line}\n`);
    });
  const base = options.base ?? {};

  const emit = (at: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void => {
    if (RANK[at] < RANK[level]) return;
    const merged = { ...base, ...fields };
    const suffix = Object.entries(merged)
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(' ');
    sink(suffix === '' ? `${at} ${message}` : `${at} ${message} ${suffix}`);
  };

  return {
    debug: (message, fields) => {
      emit('debug', message, fields);
    },
    info: (message, fields) => {
      emit('info', message, fields);
    },
    warn: (message, fields) => {
      emit('warn', message, fields);
    },
    error: (message, fields) => {
      emit('error', message, fields);
    },
    child: (fields) => createLogger({ ...options, level, base: { ...base, ...fields } }),
  };
}

/** Logger that swallows everything. Default for library code and tests. */
export const silentLogger: Logger = createLogger({ level: 'silent' });

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return value.message;
  // JSON.stringify returns undefined for these, despite being declared as
  // returning string, so they are handled before the call rather than after.
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'undefined';
  }
  return JSON.stringify(value);
}

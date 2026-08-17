import { renderTable, type Table } from './table.js';

/**
 * Output goes to stdout so a piped consumer only ever sees data; progress and
 * errors go to stderr, matching the logger's own stream choice.
 */
export interface Streams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export function writeJson(streams: Streams, data: unknown): void {
  streams.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

export function writeTable(streams: Streams, table: Table): void {
  streams.stdout.write(`${renderTable(table)}\n`);
}

export function writeLine(streams: Streams, line: string): void {
  streams.stdout.write(`${line}\n`);
}

export function writeProgress(streams: Streams, line: string): void {
  streams.stderr.write(`${line}\n`);
}

export function writeError(streams: Streams, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  streams.stderr.write(`error: ${message}\n`);
}

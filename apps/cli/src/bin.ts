#!/usr/bin/env node
import { CommanderError } from 'commander';
import { loadConfig } from '@fpl/config';
import { createLogger } from '@fpl/core';
import { HttpClient } from '@fpl/ingest';
import { FileStore } from '@fpl/store';
import { buildProgram } from './program.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const store = new FileStore({ root: config.dataDir });
  const http = new HttpClient({
    baseUrl: config.fpl.baseUrl,
    timeoutMs: config.fpl.timeoutMs,
    retries: config.fpl.retries,
    minRequestIntervalMs: config.fpl.minRequestIntervalMs,
    userAgent: config.fpl.userAgent,
    logger,
  });

  const program = buildProgram({ config, store, logger, http });
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  // A CommanderError from help or version display already wrote its own
  // output and carries its own exit code; anything else is a real failure.
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    if (error.exitCode !== 0) {
      process.stderr.write(`${error.message}\n`);
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
});

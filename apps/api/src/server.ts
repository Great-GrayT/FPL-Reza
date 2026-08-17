import { buildServer } from './app.js';
import { createDeps } from './deps.js';

const deps = createDeps();
const app = buildServer(deps);

const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '127.0.0.1';

async function start(): Promise<void> {
  try {
    await app.listen({ port, host });
  } catch (error) {
    deps.logger.error('failed to start server', { error: String(error) });
    process.exitCode = 1;
  }
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  deps.logger.info('shutting down', { signal });
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

void start();

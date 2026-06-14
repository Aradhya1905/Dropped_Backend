/**
 * server — boots the app and listens. Graceful shutdown closes the DB pool.
 */
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/client.js';

async function main(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

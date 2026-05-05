import path from 'node:path';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

async function bootstrap() {
  // Ensure upload directories exist
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.resolve(config.uploads.dir, 'photos'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'signatures'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'pdfs'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'arbeitsauftraege'), { recursive: true });

  // Run DB migrations
  await migrate();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[Server] Bautagesbericht-API läuft auf Port ${config.port}`);
    console.log(`[Server] Umgebung: ${config.nodeEnv}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Server] Startfehler:', err);
  process.exit(1);
});

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import reportRoutes from './routes/report.routes.js';
import adminRoutes from './routes/admin.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function bootstrap() {
  // Ensure upload directories exist
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.resolve(config.uploads.dir, 'photos'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'signatures'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'pdfs'), { recursive: true });
  await mkdir(path.resolve(config.uploads.dir, 'arbeitsauftraege'), { recursive: true });

  // Run DB migrations
  await migrate();

  const app = express();

  // Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({
    origin: config.nodeEnv === 'production'
      ? false // In production, served from same origin
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  // Static uploads
  app.use('/uploads', express.static(path.resolve(config.uploads.dir)));

  // API Routes
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/admin', adminRoutes);

  // Error handler
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`[Server] Bautagesbericht-API läuft auf Port ${config.port}`);
    console.log(`[Server] Umgebung: ${config.nodeEnv}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Server] Startfehler:', err);
  process.exit(1);
});

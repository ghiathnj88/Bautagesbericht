import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://patzig:patzig_secret@localhost:5432/bautagesbericht',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiresIn: '8h',
    refreshExpiresIn: '7d',
  },
  encryptionKey: process.env.ENCRYPTION_KEY || 'dev-encryption-key-32bytes!!',
  admin: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
  uploads: {
    dir: process.env.UPLOADS_DIR || './uploads',
    maxFileSize: 15 * 1024 * 1024, // 15MB
  },
} as const;

// Globales Setup für Integration-Tests.
// Wird vor jedem Test-Modul (in vitest.integration.config.ts via setupFiles)
// einmal pro Worker ausgeführt — setzt ENV-Variablen, sodass `config.ts`
// beim ersten Import die Test-Werte liest.

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Test-DB: erwartet eine separate Datenbank `bautagesbericht_test`
// auf demselben Postgres wie der Dev-Server. In CI: Service-Container.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://patzig:patzig_secret@localhost:5432/bautagesbericht_test';

// Stabile, deterministische Secrets — keine Auswirkung auf die echte App,
// nur für Tests.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-jwt-secret-AAAAAAAAAA';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'integration-test-refresh-secret-BBBBBBBBBB';
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || 'integration-test-encryption-key-32-byte';

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// FTP wird in einzelnen Suites mit ftp-srv embedded ersetzt — die ENV-Variablen
// werden dann pro Suite überschrieben.
process.env.FTP_HOST = process.env.FTP_HOST || 'localhost';
process.env.FTP_PORT = process.env.FTP_PORT || '21';
process.env.FTP_USER = process.env.FTP_USER || 'ftpuser';
process.env.FTP_PASSWORD = process.env.FTP_PASSWORD || 'ftppass';

// Schlanker Uploads-Dir nur für Tests
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || './uploads-test';

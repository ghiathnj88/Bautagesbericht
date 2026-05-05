import { defineConfig } from 'vitest/config';

// Integration-Tests: nutzen Postgres (Service-Container in CI, lokaler Test-Container)
// und einen embedded FTP-Server (ftp-srv). Sequentielle Ausführung pro Datei,
// damit DB- und FTP-State nicht zwischen parallelen Tests kollidieren.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.integration.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // alle Integration-Tests in einem Worker → kein Port-Konflikt
      },
    },
    setupFiles: ['./src/test/integration-setup.ts'],
    testTimeout: 30000, // FTP- und DB-Setup dauert
    hookTimeout: 30000,
  },
});

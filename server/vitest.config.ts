import { defineConfig } from 'vitest/config';

// Default-Konfig für Unit-Tests (schnell, ohne DB/FTP).
// Integration-Tests laufen über vitest.integration.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', 'node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.integration.test.ts', 'src/db/migrate.ts', 'src/index.ts'],
    },
  },
});

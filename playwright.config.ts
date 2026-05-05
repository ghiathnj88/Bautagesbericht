import { defineConfig, devices } from '@playwright/test';

// E2E-Tests gegen den lokal hochgefahrenen docker-compose-Stack.
// In CI: GitHub Actions startet den Stack vorher per Workflow-Step.
// Lokal: `docker compose up -d` muss vor `npm run test:e2e` laufen, oder
// `webServer` (s.u.) übernimmt das automatisch.

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false, // FTP-/DB-State teilen sich, deshalb sequenziell
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

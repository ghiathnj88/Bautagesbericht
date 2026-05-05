// Smoke-Test: lädt die Login-Seite und meldet sich als Admin an.
// Bestätigt damit, dass:
//   - der lokale Stack läuft (postgres + server + client)
//   - die DB migriert + initial-Admin gesetzt wurde
//   - das Frontend die API erreicht und Login funktioniert
//
// Vor dem Lauf muss der Test-Stack hochgefahren sein:
//   docker compose -f docker-compose.test.yml up --build -d
// Anschließend: E2E_BASE_URL=http://localhost:8080 npm run test:e2e

import { test, expect } from '@playwright/test';

test('Admin-Login + Hauptmenü erscheint', async ({ page }) => {
  await page.goto('/');

  // Login-Formular ist auf /login (oder Wurzel mit Redirect)
  await page.waitForURL(/\/login/, { timeout: 10_000 }).catch(() => undefined);

  await page.locator('input[type="text"], input[name*="user"]').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('admin123');
  await page.locator('button[type="submit"], button:has-text("Anmelden"), button:has-text("Login")').first().click();

  // Nach erfolgreichem Login: Admin landet auf /admin/* mit drei Tab-Buttons.
  // getByRole ist robuster als text-Selektoren — "Projekte" steht im UI auch
  // als Heading und im Empty-State, getByRole filtert auf Buttons.
  await expect(page.getByRole('button', { name: 'Projekte', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Berichte', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Benutzerverwaltung', exact: true })).toBeVisible();
});

test('API health-check', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

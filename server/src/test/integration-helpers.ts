// Hilfsfunktionen für Integration-Tests: App-Instanz erzeugen, Test-DB
// vorbereiten, Test-User seeden, Tabellen zwischen Tests truncaten.

import bcrypt from 'bcrypt';
import { db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { users, reports, settings, reportPhotos, reportSignatures, auditLog } from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { createApp } from '../app.js';

let migrated = false;

// Migrationen einmal pro Test-Lauf — danach sind alle Tabellen da.
export async function setupTestDb(): Promise<void> {
  if (migrated) return;
  await migrate();
  migrated = true;
}

// Alle relevanten Tabellen leeren (für jeden Test ein sauberer State).
// Reihenfolge wichtig: Kindstabellen zuerst.
export async function truncateAllTables(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE ${reportPhotos}, ${reportSignatures}, ${auditLog}, ${reports}, ${settings}, ${users} RESTART IDENTITY CASCADE`);
}

export async function seedAdminUser(username = 'admin', password = 'admin123'): Promise<{ id: string }> {
  const hash = await bcrypt.hash(password, 10);
  const [u] = await db.insert(users).values({
    username,
    passwordHash: hash,
    fullName: 'Test Admin',
    role: 'admin',
    active: true,
  }).returning({ id: users.id });
  return u;
}

export async function seedBauleiterUser(username = 'bauleiter', password = 'bauleiter123'): Promise<{ id: string }> {
  const hash = await bcrypt.hash(password, 10);
  const [u] = await db.insert(users).values({
    username,
    passwordHash: hash,
    fullName: 'Test Bauleiter',
    role: 'bauleiter',
    active: true,
  }).returning({ id: users.id });
  return u;
}

// Liefert eine frische Express-App-Instanz für supertest.
export function getTestApp() {
  return createApp();
}

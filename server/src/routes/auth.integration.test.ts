// Integration-Test für den Auth-Flow.
// Nutzt eine echte Postgres-Instanz (Test-DB) und supertest gegen die
// vollständige Express-App.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  setupTestDb,
  truncateAllTables,
  seedAdminUser,
  getTestApp,
} from '../test/integration-helpers.js';

const app = getTestApp();

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await truncateAllTables();
});

describe('POST /api/auth/login', () => {
  it('liefert Tokens bei korrekten Credentials', async () => {
    await seedAdminUser('admin', 'admin123');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.user.username).toBe('admin');
    expect(res.body.user.role).toBe('admin');
    // Refresh-Token muss als HTTP-only-Cookie gesetzt sein
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'].some((c: string) => c.includes('HttpOnly'))).toBe(true);
  });

  it('lehnt ungültiges Passwort mit 401 ab', async () => {
    await seedAdminUser('admin', 'admin123');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('lehnt unbekannten User mit 401 ab', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'doesnotexist', password: 'whatever' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('liefert User-Info mit gültigem Token', async () => {
    await seedAdminUser('admin', 'admin123');

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });
    const token = loginRes.body.accessToken;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('admin');
  });

  it('verweigert ohne Token mit 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

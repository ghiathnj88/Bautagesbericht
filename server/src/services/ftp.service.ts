import { Client } from 'basic-ftp';
import path from 'node:path';
import { db } from '../db/connection.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from './crypto.service.js';
import { config } from '../config.js';

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return null;
  return decrypt(row.valueEncrypted);
}

export async function uploadToFtp(localRelPath: string, remotePath: string): Promise<void> {
  const host = await getSetting('ftp_host');
  const user = await getSetting('ftp_user');
  const pass = await getSetting('ftp_password');

  if (!host || !user || !pass) {
    throw new Error('FTP-Einstellungen nicht konfiguriert. Bitte im Admin-Bereich einrichten.');
  }

  const port = parseInt(await getSetting('ftp_port') || '21', 10);
  const secure = (await getSetting('ftp_secure')) === 'true';

  const client = new Client();
  try {
    await client.access({ host, port, user, password: pass, secure });
    await client.ensureDir(path.dirname(remotePath));
    await client.uploadFrom(path.resolve(config.uploads.dir, localRelPath), remotePath);
  } finally {
    client.close();
  }
}

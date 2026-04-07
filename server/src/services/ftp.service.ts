import { Client } from 'basic-ftp';
import path from 'node:path';
import { config } from '../config.js';

export async function uploadToFtp(localRelPath: string, remotePath: string): Promise<void> {
  const host = process.env.FTP_HOST || '';
  const port = parseInt(process.env.FTP_PORT || '21', 10);
  const user = process.env.FTP_USER || '';
  const pass = process.env.FTP_PASSWORD || '';

  if (!host || !user || !pass) {
    throw new Error('FTP-Einstellungen nicht konfiguriert (FTP_HOST, FTP_USER, FTP_PASSWORD).');
  }

  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access({ host, port, user, password: pass, secure: false });
    await client.ensureDir(path.posix.dirname(remotePath));
    await client.uploadFrom(path.resolve(config.uploads.dir, localRelPath), remotePath);
    console.log(`[FTP] Uploaded: ${remotePath}`);
  } finally {
    client.close();
  }
}

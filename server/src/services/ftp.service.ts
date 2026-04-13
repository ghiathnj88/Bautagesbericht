import { Client } from 'basic-ftp';
import { Writable } from 'node:stream';
import path from 'node:path';
import { config } from '../config.js';

function ftpCreds() {
  const host = process.env.FTP_HOST || '';
  const port = parseInt(process.env.FTP_PORT || '21', 10);
  const user = process.env.FTP_USER || '';
  const pass = process.env.FTP_PASSWORD || '';
  if (!host || !user || !pass) {
    throw new Error('FTP-Einstellungen nicht konfiguriert (FTP_HOST, FTP_USER, FTP_PASSWORD).');
  }
  return { host, port, user, password: pass, secure: false };
}

export async function uploadToFtp(localRelPath: string, remotePath: string): Promise<void> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    // Navigate to target directory, then upload just the filename
    const dir = path.posix.dirname(remotePath);
    const filename = path.posix.basename(remotePath);
    if (dir && dir !== '.') {
      await client.cd(dir);
    }
    await client.uploadFrom(path.resolve(config.uploads.dir, localRelPath), filename);
    console.log(`[FTP] Uploaded: ${remotePath}`);
  } finally {
    client.close();
  }
}

export type FtpEntry = { name: string; type: 'dir' | 'file'; size: number };

export async function listFtpDir(remoteDir: string): Promise<FtpEntry[]> {
  const dir = remoteDir && remoteDir.startsWith('/') ? remoteDir : '/' + (remoteDir || '');
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    const items = await client.list(dir);
    return items
      .filter((i) => i.isDirectory || (i.isFile && i.name.toLowerCase().endsWith('.pdf')))
      .map((i) => ({
        name: i.name,
        type: i.isDirectory ? ('dir' as const) : ('file' as const),
        size: i.size,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  } finally {
    client.close();
  }
}

export async function downloadFromFtp(remotePath: string): Promise<Buffer> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    const chunks: Buffer[] = [];
    const writable = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    await client.downloadTo(writable, remotePath);
    return Buffer.concat(chunks);
  } finally {
    client.close();
  }
}

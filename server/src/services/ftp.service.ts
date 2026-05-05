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

// Wenn `unique: true`, wird ein bereits vergebener Dateiname automatisch
// um `_2`, `_3`, … ergänzt — verhindert stilles Überschreiben bei zwei
// Berichten am selben Tag/Auftrag oder zwei manuellen Uploads mit gleichem
// Original-Namen. Liefert den **tatsächlich** geschriebenen Pfad zurück.
export async function uniquifyName(client: Client, filename: string): Promise<string> {
  const items = await client.list();
  const existing = new Set(items.map((i) => i.name));
  if (!existing.has(filename)) return filename;

  const dotIdx = filename.lastIndexOf('.');
  const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
  const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';

  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}_${i}${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
  // Fallback bei extrem vielen Kollisionen: unverwechselbarer Zeitstempel
  return `${base}_${Date.now()}${ext}`;
}

export async function uploadToFtp(
  localRelPath: string,
  remotePath: string,
  opts: { unique?: boolean } = {}
): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    const dir = path.posix.dirname(remotePath);
    let filename = path.posix.basename(remotePath);
    // ensureDir is mkdir -p + cd: creates any missing intermediate directories
    // so uploads work even into fresh project folders. Anschließend sind wir
    // im Zielordner, sodass listing/upload den richtigen Kontext haben.
    if (dir && dir !== '.') {
      await client.ensureDir(dir);
    }
    if (opts.unique) {
      filename = await uniquifyName(client, filename);
    }
    await client.uploadFrom(path.resolve(config.uploads.dir, localRelPath), filename);
    const finalPath = dir && dir !== '.' ? `${dir}/${filename}` : filename;
    console.log(`[FTP] Uploaded: ${finalPath}`);
    return finalPath;
  } finally {
    client.close();
  }
}

// Lädt einen In-Memory-Buffer (z.B. ein vom Bauleiter im Browser ausgewähltes
// Bild/Video aus Multer.memoryStorage) direkt zum FTP. Wird für nachträgliche
// Uploads im FTP-Browser genutzt — die Datei landet nicht erst im
// uploads/-Volume auf der Disk.
export async function uploadBufferToFtp(
  buffer: Buffer,
  remotePath: string,
  opts: { unique?: boolean } = {}
): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    const dir = path.posix.dirname(remotePath);
    let filename = path.posix.basename(remotePath);
    if (dir && dir !== '.') {
      await client.ensureDir(dir);
    }
    if (opts.unique) {
      filename = await uniquifyName(client, filename);
    }
    const { Readable } = await import('node:stream');
    await client.uploadFrom(Readable.from(buffer), filename);
    const finalPath = dir && dir !== '.' ? `${dir}/${filename}` : filename;
    console.log(`[FTP] Uploaded buffer: ${finalPath} (${buffer.length} bytes)`);
    return finalPath;
  } finally {
    client.close();
  }
}

// Legt ein Verzeichnis (rekursiv falls nötig) auf dem FTP an. Idempotent.
export async function ensureFtpDir(remotePath: string): Promise<void> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    await client.ensureDir(remotePath);
  } finally {
    client.close();
  }
}

// Löscht eine Datei auf dem FTP. Wirft, wenn die Datei nicht existiert oder
// die Berechtigung fehlt — der aufrufende Code soll diese Fehler an den Nutzer
// weiterreichen.
export async function deleteFromFtpFile(remotePath: string): Promise<void> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    await client.remove(remotePath);
    console.log(`[FTP] Deleted: ${remotePath}`);
  } finally {
    client.close();
  }
}

// Verschiebt eine Datei auf dem FTP. Wenn im Zielordner schon eine Datei mit
// gleichem Namen existiert, wird ein Auto-Suffix (`_2`, `_3`, …) angehängt
// — niemals stillschweigend überschreiben. Liefert den finalen Zielpfad zurück.
export async function moveOnFtp(sourcePath: string, targetDir: string): Promise<string> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    const filename = path.posix.basename(sourcePath);
    await client.ensureDir(targetDir); // legt fehlende Zwischenordner an + cd
    const finalName = await uniquifyName(client, filename);
    const finalPath = `${targetDir.replace(/\/$/, '')}/${finalName}`;
    await client.rename(sourcePath, finalPath);
    console.log(`[FTP] Moved: ${sourcePath} → ${finalPath}`);
    return finalPath;
  } finally {
    client.close();
  }
}

export type FtpEntry = { name: string; type: 'dir' | 'file'; size: number };
export type FtpListResult = { path: string; entries: FtpEntry[] };

export async function listFtpDir(
  remoteDir?: string | null,
  opts: { includeAllFiles?: boolean } = {}
): Promise<FtpListResult> {
  const client = new Client();
  client.ftp.verbose = false;
  try {
    await client.access(ftpCreds());
    if (remoteDir && remoteDir.length > 0) {
      const dir = remoteDir.startsWith('/') ? remoteDir : '/' + remoteDir;
      await client.cd(dir);
    }
    const currentPath = await client.pwd();
    const items = await client.list();
    const entries: FtpEntry[] = items
      .filter((i) => {
        if (i.isDirectory) return true;
        if (!i.isFile) return false;
        return opts.includeAllFiles || i.name.toLowerCase().endsWith('.pdf');
      })
      .map((i) => ({
        name: i.name,
        type: i.isDirectory ? ('dir' as const) : ('file' as const),
        size: i.size,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return { path: currentPath, entries };
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

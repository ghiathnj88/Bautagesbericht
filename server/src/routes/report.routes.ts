import { Router, Request, Response } from 'express';
import { db } from '../db/connection.js';
import { reports, reportPhotos, reportSignatures } from '../db/schema.js';
import { authenticateToken } from '../middleware/auth.js';
import { eq, desc } from 'drizzle-orm';
import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { config } from '../config.js';
import {
  extractArbeitsauftragFields,
  formatYyMmDd,
} from '../services/pdf-extract.service.js';

const router = Router();
router.use(authenticateToken);

function paramId(req: Request): string {
  return req.params.id as string;
}

// Multer config for photo uploads
const storage = multer.diskStorage({
  destination: path.resolve(config.uploads.dir, 'photos'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Nur Bilddateien erlaubt'));
  },
});

// Multer config for PDF uploads (Arbeitsauftrag)
const pdfStorage = multer.diskStorage({
  destination: path.resolve(config.uploads.dir, 'arbeitsauftraege'),
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}.pdf`);
  },
});
const uploadPdf = multer({
  storage: pdfStorage,
  limits: { fileSize: config.uploads.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Nur PDF-Dateien erlaubt'));
  },
});

// === PDF Text Extraction ===

const extractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploads.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Nur PDF-Dateien erlaubt'));
  },
});

// Auto-generate PDF, upload to FTP, and send the report by email when the
// Bautagesbericht is completed. Runs asynchronously after submit; failures in
// one channel (FTP or email) are logged but do not abort the other.
async function deliverCompletedReport(reportId: string, dataJson: any): Promise<void> {
  // Load photos
  const photos = await db.select().from(reportPhotos).where(eq(reportPhotos.reportId, reportId));
  const { readFile } = await import('node:fs/promises');
  const photoBase64s: string[] = [];
  for (const photo of photos) {
    try {
      const absPath = path.resolve(config.uploads.dir, photo.filePath);
      const buf = await readFile(absPath);
      photoBase64s.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    } catch { /* skip */ }
  }

  // Generate PDF
  const { generatePdf } = await import('../services/pdf.service.js');
  const pdfPath = await generatePdf(reportId, { ...dataJson, photoBase64s });
  await db.update(reports).set({ ftpReportPath: pdfPath }).where(eq(reports.id, reportId));

  // Sauberer, sortierbarer Dateiname konsistent mit dem Bilder-Ordner-Format
  // (YY-MM-DD). Kollisionen — z.B. zwei Berichte am selben Tag und Auftrag
  // (Früh-/Spätschicht) — werden im FTP-Service durch Auto-Suffix `_2`, `_3`
  // automatisch entschärft (`unique: true` weiter unten).
  const bv = dataJson.bvNummer || reportId;
  const yymmdd = formatYyMmDd(dataJson.datum);
  const fileName = `Bautagesbericht_${bv}_${yymmdd}.pdf`;

  // ftpSourcePath ist der Monteur-Ordner des Projekts (gesetzt vom FTP-Picker).
  // Bericht landet in `${monteurDir}/BTB/`, Fotos in `${monteurDir}/<YY-MM-DD>/`.
  const monteurDir = (dataJson.ftpSourcePath as string | undefined)?.trim()?.replace(/\/$/, '');

  // 1) Upload Bautagesbericht-PDF nach Monteur/BTB/ (Patzig-Struktur).
  try {
    const { uploadToFtp } = await import('../services/ftp.service.js');
    const remotePath = monteurDir
      ? `${monteurDir}/BTB/${fileName}`
      : `berichte/${fileName}`;
    const finalPath = await uploadToFtp(pdfPath, remotePath, { unique: true });
    console.log(`[FTP] Bautagesbericht hochgeladen nach: ${finalPath}`);
  } catch (err) {
    console.error('[FTP] Upload fehlgeschlagen:', err instanceof Error ? err.message : err);
  }

  // 2) Upload Fotos nach Monteur/<YY-MM-DD>/. Alle Tagesbilder liegen
  //    gemeinsam im Datums-Ordner. Bei identischen Original-Dateinamen
  //    (z.B. zwei Handys mit IMG_0001.jpg) sorgt der `unique`-Schalter dafür,
  //    dass die zweite Datei mit Suffix `_2` abgelegt wird und nichts
  //    überschrieben wird.
  if (monteurDir && photos.length > 0) {
    try {
      const { uploadToFtp } = await import('../services/ftp.service.js');
      const photoDir = `${monteurDir}/${yymmdd}`;
      for (const photo of photos) {
        const baseName = photo.originalName || path.posix.basename(photo.filePath);
        await uploadToFtp(photo.filePath, `${photoDir}/${baseName}`, { unique: true });
      }
      console.log(`[FTP] ${photos.length} Fotos hochgeladen nach: ${photoDir}/`);
    } catch (err) {
      console.error('[FTP] Foto-Upload fehlgeschlagen:', err instanceof Error ? err.message : err);
    }
  }

  // 3) Send email to customer with the PDF attached.
  if (dataJson.customerEmail) {
    try {
      const { sendReportEmail } = await import('../services/email.service.js');
      await sendReportEmail(dataJson.customerEmail, {
        bvNummer: dataJson.bvNummer || '',
        datum: dataJson.datum || '',
        bauleiter: dataJson.bauleiter || '',
      }, pdfPath);
      console.log(`[Email] Bautagesbericht an ${dataJson.customerEmail} gesendet`);
    } catch (err) {
      console.error('[Email] Versand fehlgeschlagen:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[Email] Kein customerEmail im Bericht gesetzt – E-Mail wird nicht versendet.');
  }
}


router.post('/extract-pdf', extractUpload.single('pdf'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'Keine PDF-Datei' }); return; }

  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(req.file.buffer);
    const extracted = extractArbeitsauftragFields(result.text);
    res.json({ extracted, rawText: result.text.substring(0, 2000) });
  } catch (err) {
    res.status(500).json({ error: 'PDF konnte nicht gelesen werden' });
  }
});

// === FTP Browse (for Arbeitsauftrag picker) ===

router.get('/ftp-browse', async (req: Request, res: Response) => {
  const raw = ((req.query.path as string) || '').trim();
  const includeAllFiles = req.query.all === '1' || req.query.all === 'true';
  let cleanPath: string | undefined = undefined;
  if (raw) {
    cleanPath = path.posix.normalize(raw.startsWith('/') ? raw : '/' + raw);
    if (cleanPath.split('/').some((s) => s === '..')) {
      res.status(400).json({ error: 'Ungültiger Pfad' });
      return;
    }
  }
  try {
    const { listFtpDir } = await import('../services/ftp.service.js');
    const result = await listFtpDir(cleanPath, { includeAllFiles });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FTP-Fehler';
    console.error('[FTP] Browse failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Stream a file from FTP directly to the browser so the UI can preview
// PDFs and images in a new tab. Content-Type is inferred from the extension.
router.get('/ftp-download', async (req: Request, res: Response) => {
  const raw = ((req.query.path as string) || '').trim();
  if (!raw) { res.status(400).json({ error: 'Kein Pfad angegeben' }); return; }
  const cleanPath = path.posix.normalize(raw.startsWith('/') ? raw : '/' + raw);
  if (cleanPath.split('/').some((s) => s === '..')) {
    res.status(400).json({ error: 'Ungültiger Pfad' });
    return;
  }
  try {
    const { downloadFromFtp } = await import('../services/ftp.service.js');
    const buf = await downloadFromFtp(cleanPath);
    const ext = path.posix.extname(cleanPath).toLowerCase();
    const mime: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${path.posix.basename(cleanPath)}"`);
    res.send(buf);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FTP-Fehler';
    console.error('[FTP] Download failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Manueller Upload zusätzlicher Bilder/Videos in einen FTP-Ordner. Vom
// Bauleiter aus dem FTP-Browser ausgelöst, wenn er nachträglich weitere Belege
// in einen Datums-Ordner unter Monteur/ legen will (siehe Patrick-Mail vom
// 27.04.2026). Memory-Upload ohne lokalen Disk-Umweg, Pfad-Validation gegen
// path-traversal, MIME-Filter auf Bild/Video, ein Fehler stoppt den Rest nicht.
const adhocUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB pro Datei (Videos)
  fileFilter: (_req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Nur Bilder oder Videos sind erlaubt'));
  },
});

// Manuelles Anlegen eines Unterordners im Bilder-Bereich. Vom Bauleiter genutzt,
// um Fotos einer bestimmten Baustellen-Zone (z.B. "Dachseite", "Eingang") zu
// trennen. Pfad-/Namens-Validation streng: nur unterhalb von Monteur/<YY-MM-DD>/
// erlaubt, kein Pfadtrenner und kein "..".
router.post('/ftp-mkdir', async (req: Request, res: Response) => {
  const parentRaw = (req.body?.parentPath as string | undefined)?.trim();
  const dirNameRaw = (req.body?.dirName as string | undefined)?.trim();
  if (!parentRaw || !dirNameRaw) {
    res.status(400).json({ error: 'parentPath und dirName erforderlich' });
    return;
  }

  const parentPath = path.posix.normalize(parentRaw.startsWith('/') ? parentRaw : '/' + parentRaw);
  if (parentPath.split('/').some((s) => s === '..')) {
    res.status(400).json({ error: 'Ungültiger Pfad' });
    return;
  }
  // Nur innerhalb der Patzig-Datums-Ordner erlauben (Tiefe egal — Bauleiter
  // darf in Unterordnern weiter verschachteln).
  if (!/\/Monteur\/\d{2}-\d{2}-\d{2}(\/|$)/.test(parentPath)) {
    res.status(400).json({ error: 'Unterordner dürfen nur innerhalb von Monteur/<YY-MM-DD>/ angelegt werden' });
    return;
  }

  // Dateiname-Sanitization: erlaubt sind Buchstaben (incl. Umlaute), Ziffern,
  // Leerzeichen, _ - ( ); kein Punkt am Anfang, kein Pfadtrenner, max. 80 Zeichen.
  const dirName = dirNameRaw.replace(/\s+/g, ' ');
  if (
    dirName.length === 0 ||
    dirName.length > 80 ||
    dirName.startsWith('.') ||
    /[\\/]/.test(dirName) ||
    !/^[A-Za-zÄÖÜäöüß0-9 _\-()]+$/.test(dirName)
  ) {
    res.status(400).json({ error: 'Ungültiger Ordnername' });
    return;
  }

  const newPath = `${parentPath.replace(/\/$/, '')}/${dirName}`;
  try {
    const { ensureFtpDir } = await import('../services/ftp.service.js');
    await ensureFtpDir(newPath);
    res.json({ ok: true, path: newPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FTP-Fehler';
    console.error('[FTP] mkdir failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Löscht eine einzelne Datei auf dem FTP. Validation analog zu mkdir/move:
// nur innerhalb von Monteur/<YY-MM-DD>/ erlaubt, keine Path-Traversal-Tricks.
router.post('/ftp-delete', async (req: Request, res: Response) => {
  const targetRaw = (req.body?.path as string | undefined)?.trim();
  if (!targetRaw) {
    res.status(400).json({ error: 'path erforderlich' });
    return;
  }
  const targetPath = path.posix.normalize(targetRaw.startsWith('/') ? targetRaw : '/' + targetRaw);
  if (targetPath.split('/').some((s) => s === '..')) {
    res.status(400).json({ error: 'Ungültiger Pfad' });
    return;
  }
  if (!/\/Monteur\/\d{2}-\d{2}-\d{2}\/.+/.test(targetPath)) {
    res.status(400).json({ error: 'Löschen nur innerhalb von Monteur/<YY-MM-DD>/ erlaubt' });
    return;
  }
  try {
    const { deleteFromFtpFile } = await import('../services/ftp.service.js');
    await deleteFromFtpFile(targetPath);
    res.json({ ok: true, path: targetPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'FTP-Fehler';
    console.error('[FTP] delete failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// Verschiebt eine oder mehrere Dateien innerhalb eines Datums-Ordners in einen
// Unterordner (oder zurück in den Datums-Ordner selbst). Quelle und Ziel
// müssen denselben `Monteur/<YY-MM-DD>` als Vorfahren haben — Cross-Day-
// Verschieben wird nicht erlaubt, um versehentliche Datenwanderung zwischen
// Tagen zu verhindern.
router.post('/ftp-move', async (req: Request, res: Response) => {
  const sourcePathsRaw = req.body?.sourcePaths;
  const targetDirRaw = (req.body?.targetDir as string | undefined)?.trim();
  if (!Array.isArray(sourcePathsRaw) || sourcePathsRaw.length === 0 || !targetDirRaw) {
    res.status(400).json({ error: 'sourcePaths (array) und targetDir erforderlich' });
    return;
  }

  const targetDir = path.posix.normalize(targetDirRaw.startsWith('/') ? targetDirRaw : '/' + targetDirRaw);
  if (targetDir.split('/').some((s) => s === '..')) {
    res.status(400).json({ error: 'Ungültiger Ziel-Pfad' });
    return;
  }
  const targetDateMatch = targetDir.match(/^(.*\/Monteur\/\d{2}-\d{2}-\d{2})(\/|$)/);
  if (!targetDateMatch) {
    res.status(400).json({ error: 'Ziel muss innerhalb von Monteur/<YY-MM-DD>/ liegen' });
    return;
  }
  const targetDateRoot = targetDateMatch[1];

  const { moveOnFtp } = await import('../services/ftp.service.js');
  const moved: { name: string; newPath: string }[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const raw of sourcePathsRaw) {
    if (typeof raw !== 'string') {
      failed.push({ name: String(raw), error: 'Ungültiger Pfad' });
      continue;
    }
    const src = path.posix.normalize(raw.startsWith('/') ? raw : '/' + raw);
    const baseName = path.posix.basename(src);
    if (src.split('/').some((s) => s === '..')) {
      failed.push({ name: baseName, error: 'Ungültiger Pfad' });
      continue;
    }
    // Quelle muss im selben Datums-Ordner liegen wie das Ziel.
    if (!src.startsWith(targetDateRoot + '/')) {
      failed.push({ name: baseName, error: 'Quelle und Ziel müssen im selben Tages-Ordner liegen' });
      continue;
    }
    if (src === targetDir + '/' + baseName) {
      // Quelle = Ziel — nichts zu tun, aber als Erfolg melden.
      moved.push({ name: baseName, newPath: src });
      continue;
    }
    try {
      const newPath = await moveOnFtp(src, targetDir);
      moved.push({ name: baseName, newPath });
    } catch (err) {
      failed.push({ name: baseName, error: err instanceof Error ? err.message : 'Verschieben fehlgeschlagen' });
    }
  }
  res.json({ moved, failed });
});

router.post('/ftp-upload-files', adhocUpload.array('files', 20), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'Keine Dateien empfangen' });
    return;
  }
  const remoteDirRaw = (req.body?.remoteDir as string | undefined)?.trim();
  if (!remoteDirRaw) {
    res.status(400).json({ error: 'Kein Zielordner angegeben (remoteDir)' });
    return;
  }
  const remoteDir = path.posix.normalize(remoteDirRaw.startsWith('/') ? remoteDirRaw : '/' + remoteDirRaw);
  if (remoteDir.split('/').some((s) => s === '..')) {
    res.status(400).json({ error: 'Ungültiger Pfad' });
    return;
  }

  const { uploadBufferToFtp } = await import('../services/ftp.service.js');
  const uploaded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const file of files) {
    const safeName = path.posix.basename(file.originalname); // keine Pfadtrenner im Dateinamen
    if (!safeName) { failed.push({ name: file.originalname, error: 'Ungültiger Dateiname' }); continue; }
    const remotePath = `${remoteDir.replace(/\/$/, '')}/${safeName}`;
    try {
      // unique:true → bei gleichem Namen wird der Upload mit Suffix `_2` etc.
      // abgelegt, statt eine vorhandene Datei stillschweigend zu überschreiben.
      const finalPath = await uploadBufferToFtp(file.buffer, remotePath, { unique: true });
      uploaded.push(path.posix.basename(finalPath));
    } catch (err) {
      failed.push({ name: safeName, error: err instanceof Error ? err.message : 'Upload fehlgeschlagen' });
    }
  }
  res.json({ uploaded, failed, remoteDir });
});

router.post('/extract-pdf-ftp', async (req: Request, res: Response) => {
  const remotePath = (req.body?.remotePath as string | undefined)?.trim();
  if (!remotePath) { res.status(400).json({ error: 'Kein Pfad angegeben' }); return; }
  const cleanPath = path.posix.normalize(remotePath.startsWith('/') ? remotePath : '/' + remotePath);
  if (cleanPath.split('/').some((s) => s === '..') || !cleanPath.toLowerCase().endsWith('.pdf')) {
    res.status(400).json({ error: 'Ungültiger PDF-Pfad' });
    return;
  }
  try {
    const { downloadFromFtp } = await import('../services/ftp.service.js');
    const buf = await downloadFromFtp(cleanPath);
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buf);
    const extracted = extractArbeitsauftragFields(result.text);
    res.json({ extracted, fileName: path.posix.basename(cleanPath) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PDF konnte nicht geladen werden';
    console.error('[FTP] Extract failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// === CRUD ===

// List reports for current user
router.get('/', async (req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.userId, req.user!.userId))
    .orderBy(desc(reports.createdAt));
  res.json(rows);
});

// Get single report
router.get('/:id', async (req: Request, res: Response) => {
  const [report] = await db
    .select()
    .from(reports)
    .where(eq(reports.id, paramId(req)));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (report.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }
  res.json(report);
});

// Create report
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;
  const [report] = await db.insert(reports).values({
    userId: req.user!.userId,
    status: body.status || 'draft',
    bvNummer: body.bvNummer,
    auftraggeber: body.auftraggeber,
    lieferanschrift: body.lieferanschrift,
    projektbezeichnung: body.projektbezeichnung || null,
    sollstundenMinuten: typeof body.sollstundenMinuten === 'number' ? body.sollstundenMinuten : null,
    datum: body.datum,
    ftpSourcePath: body.ftpSourcePath,
    dataJson: body,
    completedAt: body.status === 'complete' ? new Date() : null,
  }).returning();

  // Auto generate PDF + FTP upload on complete
  if (body.status === 'complete') {
    deliverCompletedReport(report.id, body).catch((err: Error) => console.error('[Delivery] Failed:', err.message));
  }

  res.status(201).json(report);
});

// Update report
router.put('/:id', async (req: Request, res: Response) => {
  const body = req.body;
  const [existing] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!existing) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (existing.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  const [updated] = await db.update(reports).set({
    status: body.status || existing.status,
    bvNummer: body.bvNummer,
    auftraggeber: body.auftraggeber,
    lieferanschrift: body.lieferanschrift,
    projektbezeichnung: body.projektbezeichnung || null,
    sollstundenMinuten: typeof body.sollstundenMinuten === 'number' ? body.sollstundenMinuten : null,
    datum: body.datum,
    ftpSourcePath: body.ftpSourcePath,
    dataJson: body,
    completedAt: body.status === 'complete' ? new Date() : existing.completedAt,
  }).where(eq(reports.id, paramId(req))).returning();

  // Auto generate PDF + FTP upload on complete
  if (body.status === 'complete') {
    deliverCompletedReport(updated.id, body).catch((err: Error) => console.error('[Delivery] Failed:', err.message));
  }

  res.json(updated);
});

// Delete report
router.delete('/:id', async (req: Request, res: Response) => {
  const id = paramId(req);
  const [existing] = await db.select().from(reports).where(eq(reports.id, id));
  if (!existing) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (existing.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  // Lokale Dateien aus dem uploads-Volume aufräumen, BEVOR der DB-Eintrag
  // gelöscht wird. Sonst wären die Pfade durch CASCADE bereits weg und wir
  // könnten die Dateien nicht mehr zurückverfolgen. Fehler beim unlink werden
  // toleriert (z.B. Datei wurde manuell entfernt) — nur geloggt.
  const photoRows = await db.select().from(reportPhotos).where(eq(reportPhotos.reportId, id));
  const sigRows = await db.select().from(reportSignatures).where(eq(reportSignatures.reportId, id));
  const { unlink } = await import('node:fs/promises');
  const filesToRemove: string[] = [];
  for (const p of photoRows) if (p.filePath) filesToRemove.push(p.filePath);
  for (const s of sigRows) if (s.signaturePngPath) filesToRemove.push(s.signaturePngPath);
  if (existing.ftpReportPath) filesToRemove.push(existing.ftpReportPath);
  for (const rel of filesToRemove) {
    try {
      await unlink(path.resolve(config.uploads.dir, rel));
    } catch (err) {
      console.warn(`[Delete] Konnte Datei nicht entfernen: ${rel} (${err instanceof Error ? err.message : err})`);
    }
  }

  await db.delete(reports).where(eq(reports.id, id));
  res.json({ ok: true, filesRemoved: filesToRemove.length });
});

// === Photos ===

// Upload photos
router.post('/:id/photos', upload.array('photos', 5), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) { res.status(400).json({ error: 'Keine Dateien' }); return; }

  // Verify report ownership
  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report || report.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  const photos: { id: string; filePath: string }[] = [];

  for (const file of files) {
    // Resize/optimize with sharp
    const optimizedName = `opt_${file.filename}`;
    const optimizedPath = path.join(path.resolve(config.uploads.dir, 'photos'), optimizedName);
    await sharp(file.path)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(optimizedPath);

    const [photo] = await db.insert(reportPhotos).values({
      reportId: paramId(req),
      filePath: `photos/${optimizedName}`,
      originalName: file.originalname,
      sizeBytes: file.size,
    }).returning();

    photos.push({ id: photo.id, filePath: photo.filePath });
  }

  res.status(201).json({ photoIds: photos.map(p => p.id), photos });
});

// Get photos for a report
router.get('/:id/photos', async (req: Request, res: Response) => {
  const photos = await db
    .select()
    .from(reportPhotos)
    .where(eq(reportPhotos.reportId, paramId(req)));
  res.json(photos);
});

// === Signatures ===

// Save signature
router.post('/:id/signatures', async (req: Request, res: Response) => {
  const { type, signerName, signatureData } = req.body;
  if (!type || !signerName || !signatureData) {
    res.status(400).json({ error: 'type, signerName und signatureData erforderlich' }); return;
  }

  // Verify report ownership
  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report || report.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  // Save base64 PNG to file
  const base64Data = signatureData.replace(/^data:image\/png;base64,/, '');
  const filename = `sig_${paramId(req)}_${type}_${Date.now()}.png`;
  const filePath = path.join(path.resolve(config.uploads.dir, 'signatures'), filename);

  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(base64Data, 'base64'));

  const [sig] = await db.insert(reportSignatures).values({
    reportId: paramId(req),
    type,
    signerName,
    signaturePngPath: `signatures/${filename}`,
  }).returning();

  res.status(201).json(sig);
});

// === PDF Generation ===

router.post('/:id/pdf', async (req: Request, res: Response) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (report.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  // Load photos as base64 for PDF embedding
  const photos = await db.select().from(reportPhotos).where(eq(reportPhotos.reportId, paramId(req)));
  const { readFile } = await import('node:fs/promises');
  const photoBase64s: string[] = [];
  for (const photo of photos) {
    try {
      const absPath = path.resolve(config.uploads.dir, photo.filePath);
      const buf = await readFile(absPath);
      photoBase64s.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
    } catch { /* skip missing files */ }
  }

  const { generatePdf } = await import('../services/pdf.service.js');
  const reportData = { ...(report.dataJson as any), photoBase64s };
  const pdfPath = await generatePdf(report.id, reportData);

  // Update report with PDF path
  await db.update(reports).set({ ftpReportPath: pdfPath }).where(eq(reports.id, paramId(req)));

  res.json({ pdfPath, downloadUrl: `/uploads/${pdfPath}` });
});

// === Send Email ===

router.post('/:id/send-email', async (req: Request, res: Response) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (report.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  const data = report.dataJson as any;
  if (!data.customerEmail) { res.status(400).json({ error: 'Keine Kunden-E-Mail hinterlegt' }); return; }

  // Generate PDF first if not already done
  let pdfPath = report.ftpReportPath;
  if (!pdfPath) {
    const { generatePdf } = await import('../services/pdf.service.js');
    pdfPath = await generatePdf(report.id, data);
    await db.update(reports).set({ ftpReportPath: pdfPath }).where(eq(reports.id, paramId(req)));
  }

  const { sendReportEmail } = await import('../services/email.service.js');
  await sendReportEmail(data.customerEmail, {
    bvNummer: data.bvNummer || report.bvNummer || '',
    datum: data.datum || report.datum || '',
    bauleiter: data.bauleiter || '',
  }, pdfPath);

  res.json({ ok: true, sentTo: data.customerEmail });
});

// === Arbeitsauftrag PDF Upload ===

router.post('/:id/arbeitsauftrag', uploadPdf.single('arbeitsauftrag'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: 'Keine PDF-Datei' }); return; }

  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report || report.userId !== req.user!.userId) {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  res.status(201).json({ path: `arbeitsauftraege/${file.filename}`, originalName: file.originalname });
});

// === FTP Upload ===

router.post('/:id/ftp-upload', async (req: Request, res: Response) => {
  const [report] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (report.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }

  let pdfPath = report.ftpReportPath;
  if (!pdfPath) { res.status(400).json({ error: 'Bitte zuerst PDF generieren' }); return; }

  const data = report.dataJson as any;
  const yymmdd = formatYyMmDd(data.datum);
  const fileName = `Bautagesbericht_${data.bvNummer}_${yymmdd}.pdf`;
  const monteurDir = (data.ftpSourcePath as string | undefined)?.trim()?.replace(/\/$/, '');
  const remotePath = monteurDir
    ? `${monteurDir}/BTB/${fileName}`
    : `/berichte/${fileName}`;

  const { uploadToFtp } = await import('../services/ftp.service.js');
  const finalPath = await uploadToFtp(pdfPath, remotePath, { unique: true });

  res.json({ ok: true, remotePath: finalPath });
});

export default router;

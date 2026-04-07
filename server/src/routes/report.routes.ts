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

// Auto-generate PDF and upload to FTP when report is completed
async function autoUploadToFtp(reportId: string, dataJson: any): Promise<void> {
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

  // Update report with PDF path
  await db.update(reports).set({ ftpReportPath: pdfPath }).where(eq(reports.id, reportId));

  // Upload to FTP
  const { uploadToFtp } = await import('../services/ftp.service.js');
  const bv = dataJson.bvNummer || reportId;
  const datum = dataJson.datum?.replace(/\./g, '-') || 'unknown';
  const remotePath = `/berichte/Bautagesbericht_${bv}_${datum}.pdf`;
  await uploadToFtp(pdfPath, remotePath);
}

router.post('/extract-pdf', extractUpload.single('pdf'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'Keine PDF-Datei' }); return; }

  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(req.file.buffer);
    const text = result.text;

    // Try to extract fields from common Arbeitsauftrag PDF formats
    const extracted: Record<string, string> = {
      auftraggeber: '',
      lieferanschrift: '',
      bvNummer: '',
      kundennummer: '',
    };

    // Match patterns (flexible - works for various PDF formats)
    const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lower = line.toLowerCase();

      if (lower.includes('auftraggeber') || lower.includes('kunde:') || lower.includes('kundenname')) {
        extracted.auftraggeber = line.replace(/^.*?(auftraggeber|kunde|kundenname)[:\s]*/i, '').trim() || lines[i + 1]?.trim() || '';
      }
      if (lower.includes('lieferanschrift') || lower.includes('baustellenadresse') || lower.includes('baustelle:') || lower.includes('lieferadresse')) {
        extracted.lieferanschrift = line.replace(/^.*?(lieferanschrift|baustellenadresse|baustelle|lieferadresse)[:\s]*/i, '').trim() || lines[i + 1]?.trim() || '';
      }
      if (lower.includes('bv-nr') || lower.includes('bv nr') || lower.includes('bv nummer') || lower.includes('projektnr') || lower.includes('projekt-nr')) {
        const match = line.match(/(?:bv[- ]?n(?:umme)?r|projekt[- ]?nr)[.:\s]*([^\s,;]+)/i);
        if (match) extracted.bvNummer = match[1];
      }
      if (lower.includes('kundennr') || lower.includes('kunden-nr') || lower.includes('kundennummer') || lower.includes('kd-nr') || lower.includes('kd nr')) {
        const match = line.match(/(?:kunden?[- ]?n(?:umme)?r|kd[- ]?nr)[.:\s]*([^\s,;]+)/i);
        if (match) extracted.kundennummer = match[1];
      }
    }

    res.json({ extracted, rawText: text.substring(0, 2000) });
  } catch (err) {
    res.status(500).json({ error: 'PDF konnte nicht gelesen werden' });
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
    datum: body.datum,
    ftpSourcePath: body.ftpSourcePath,
    dataJson: body,
    completedAt: body.status === 'complete' ? new Date() : null,
  }).returning();

  // Auto generate PDF + FTP upload on complete
  if (body.status === 'complete') {
    autoUploadToFtp(report.id, body).catch((err: Error) => console.error('[FTP] Auto-upload failed:', err.message));
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
    datum: body.datum,
    ftpSourcePath: body.ftpSourcePath,
    dataJson: body,
    completedAt: body.status === 'complete' ? new Date() : existing.completedAt,
  }).where(eq(reports.id, paramId(req))).returning();

  // Auto generate PDF + FTP upload on complete
  if (body.status === 'complete') {
    autoUploadToFtp(updated.id, body).catch((err: Error) => console.error('[FTP] Auto-upload failed:', err.message));
  }

  res.json(updated);
});

// Delete report
router.delete('/:id', async (req: Request, res: Response) => {
  const [existing] = await db.select().from(reports).where(eq(reports.id, paramId(req)));
  if (!existing) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (existing.userId !== req.user!.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Keine Berechtigung' }); return;
  }
  await db.delete(reports).where(eq(reports.id, paramId(req)));
  res.json({ ok: true });
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
  const remotePath = data.ftpSourcePath
    ? `${data.ftpSourcePath}/Bautagesbericht_${data.bvNummer}_${data.datum?.replace(/\./g, '-')}.pdf`
    : `/berichte/Bautagesbericht_${data.bvNummer}_${data.datum?.replace(/\./g, '-')}.pdf`;

  const { uploadToFtp } = await import('../services/ftp.service.js');
  await uploadToFtp(pdfPath, remotePath);

  res.json({ ok: true, remotePath });
});

export default router;

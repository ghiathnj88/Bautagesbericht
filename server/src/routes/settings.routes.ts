import { Router, Request, Response } from 'express';
import { db } from '../db/connection.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { encrypt, decrypt } from '../services/crypto.service.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();

// All settings routes require admin
router.use(authenticateToken, requireRole('admin'));

// Get a setting (decrypted)
router.get('/:key', async (req: Request, res: Response) => {
  const settingKey = String(req.params.key);
  const [setting] = await db.select().from(settings).where(eq(settings.key, settingKey)).limit(1);
  if (!setting) {
    res.json({ key: settingKey, value: null });
    return;
  }
  try {
    const value = decrypt(setting.valueEncrypted);
    const sensitiveKeys = ['openai_api_key', 'ftp_password', 'smtp_password'];
    const displayValue = sensitiveKeys.includes(settingKey)
      ? value.slice(0, 4) + '****' + value.slice(-4)
      : value;
    res.json({ key: setting.key, value: displayValue, updatedAt: setting.updatedAt });
  } catch {
    res.status(500).json({ error: 'Entschlüsselung fehlgeschlagen' });
  }
});

// Set a setting (encrypted)
router.put('/:key', async (req: Request, res: Response) => {
  const settingKey = String(req.params.key);
  const { value } = req.body;
  if (value === undefined || value === null) {
    res.status(400).json({ error: 'Wert erforderlich' });
    return;
  }

  const encrypted = encrypt(String(value));
  await db.insert(settings).values({
    key: settingKey,
    valueEncrypted: encrypted,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: settings.key,
    set: { valueEncrypted: encrypted, updatedAt: new Date() },
  });

  res.json({ key: settingKey, message: 'Gespeichert' });
});

// Get all settings keys (without values)
router.get('/', async (_req: Request, res: Response) => {
  const allSettings = await db.select({
    key: settings.key,
    updatedAt: settings.updatedAt,
  }).from(settings);
  res.json(allSettings);
});

export default router;

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/connection.js';
import { users, reports } from '../db/schema.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();
router.use(authenticateToken);
router.use(requireRole('admin'));

// List all users
router.get('/users', async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
    active: users.active,
    createdAt: users.createdAt,
  }).from(users).orderBy(users.createdAt);
  res.json(rows);
});

// Create user
router.post('/users', async (req: Request, res: Response) => {
  const { username, password, fullName, role } = req.body;
  if (!username || !password || !fullName) {
    res.status(400).json({ error: 'username, password und fullName erforderlich' });
    return;
  }
  if (role && !['admin', 'bauleiter'].includes(role)) {
    res.status(400).json({ error: 'Rolle muss admin oder bauleiter sein' });
    return;
  }

  const existing = await db.select().from(users).where(eq(users.username, username));
  if (existing.length > 0) {
    res.status(409).json({ error: 'Benutzername existiert bereits' });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({
    username,
    passwordHash: hash,
    fullName,
    role: role || 'bauleiter',
  }).returning({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
    active: users.active,
  });

  res.status(201).json(user);
});

// Update user
router.put('/users/:id', async (req: Request, res: Response) => {
  const { fullName, role, active, password } = req.body;
  const id = req.params.id as string;

  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) { res.status(404).json({ error: 'Benutzer nicht gefunden' }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (fullName !== undefined) updates.fullName = fullName;
  if (role !== undefined && ['admin', 'bauleiter'].includes(role)) updates.role = role;
  if (active !== undefined) updates.active = active;
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);

  const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
    active: users.active,
  });

  res.json(updated);
});

// Delete user
router.delete('/users/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;

  // Prevent self-delete
  if (id === req.user!.userId) {
    res.status(400).json({ error: 'Eigenen Account kann man nicht löschen' });
    return;
  }

  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) { res.status(404).json({ error: 'Benutzer nicht gefunden' }); return; }

  await db.delete(users).where(eq(users.id, id));
  res.json({ ok: true });
});

// === Reports ===

// List all reports (with user info)
router.get('/reports', async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: reports.id,
      status: reports.status,
      bvNummer: reports.bvNummer,
      auftraggeber: reports.auftraggeber,
      datum: reports.datum,
      ftpReportPath: reports.ftpReportPath,
      createdAt: reports.createdAt,
      completedAt: reports.completedAt,
      userId: reports.userId,
      bauleiterName: users.fullName,
    })
    .from(reports)
    .leftJoin(users, eq(reports.userId, users.id))
    .orderBy(desc(reports.createdAt));
  res.json(rows);
});

// Get single report detail
router.get('/reports/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [report] = await db.select().from(reports).where(eq(reports.id, id));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  res.json(report);
});

// Download PDF path for a report
router.get('/reports/:id/pdf', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const [report] = await db.select().from(reports).where(eq(reports.id, id));
  if (!report) { res.status(404).json({ error: 'Bericht nicht gefunden' }); return; }
  if (!report.ftpReportPath) { res.status(404).json({ error: 'Kein PDF vorhanden' }); return; }
  res.json({ downloadUrl: `/uploads/${report.ftpReportPath}` });
});

export default router;

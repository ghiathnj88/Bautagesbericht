import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/connection.js';
import { users, reports } from '../db/schema.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { eq, desc } from 'drizzle-orm';
import {
  reportTotalMinutes,
  regularWorkerMinutes,
  azubiWorkerMinutes,
  machineMinutes,
  machineBreakdown,
  disposalKg,
  disposalBreakdown,
} from '../utils/time.js';

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
  const { username, fullName, role, active, password } = req.body;
  const id = req.params.id as string;

  const [existing] = await db.select().from(users).where(eq(users.id, id));
  if (!existing) { res.status(404).json({ error: 'Benutzer nicht gefunden' }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (fullName !== undefined) updates.fullName = fullName;
  if (role !== undefined && ['admin', 'bauleiter'].includes(role)) updates.role = role;
  if (active !== undefined) updates.active = active;
  if (password) updates.passwordHash = await bcrypt.hash(password, 12);

  if (username !== undefined && username !== existing.username) {
    // Username darf gewechselt werden, muss aber unique bleiben.
    const [conflict] = await db.select().from(users).where(eq(users.username, username));
    if (conflict && conflict.id !== id) {
      res.status(409).json({ error: 'Benutzername existiert bereits' });
      return;
    }
    updates.username = username;
  }

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

// === Projekt-Übersicht (Aggregation pro BV-Nummer) ===

type ProjectRow = {
  bvNummer: string;
  auftraggeber: string;
  projektbezeichnung: string;
  sollstundenMinuten: number;
  istMinuten: number;
  reportCount: number;
  letztesDatum: string;
  letzterStatus: string;
};

router.get('/projects', async (_req: Request, res: Response) => {
  // Sortiert: neueste zuerst — der erste Eintrag pro BV ist damit der jüngste,
  // sodass wir letztesDatum/letzterStatus ohne weiteren Vergleich übernehmen.
  // Drafts werden hier ausgeschlossen — die Stunden-Aggregation darf nur
  // tatsächlich abgeschlossene Berichte berücksichtigen, sonst verfälschen
  // halbfertige Entwürfe (mit Default-Zeiten 7:00–16:00) den Soll/Ist-Vergleich.
  // Der separate "Berichte"-Tab zeigt weiterhin alle Berichte inklusive Drafts.
  const rows = await db.select().from(reports)
    .where(eq(reports.status, 'complete'))
    .orderBy(desc(reports.createdAt));

  const byBv = new Map<string, ProjectRow>();
  for (const r of rows) {
    const bv = (r.bvNummer || '').trim();
    if (!bv) continue;

    let entry = byBv.get(bv);
    if (!entry) {
      entry = {
        bvNummer: bv,
        auftraggeber: r.auftraggeber || '',
        projektbezeichnung: r.projektbezeichnung || '',
        sollstundenMinuten: r.sollstundenMinuten || 0,
        istMinuten: 0,
        reportCount: 0,
        letztesDatum: r.datum || '',
        letzterStatus: r.status,
      };
      byBv.set(bv, entry);
    }

    entry.reportCount += 1;
    entry.istMinuten += reportTotalMinutes(r.dataJson);

    // Soll-Stunden: pro BV-Nr eigentlich konstant; wir übernehmen den größten
    // gefundenen Wert, falls einzelne Berichte den Wert nicht gespeichert haben.
    if (r.sollstundenMinuten && r.sollstundenMinuten > entry.sollstundenMinuten) {
      entry.sollstundenMinuten = r.sollstundenMinuten;
    }
    if (!entry.projektbezeichnung && r.projektbezeichnung) {
      entry.projektbezeichnung = r.projektbezeichnung;
    }
    if (!entry.auftraggeber && r.auftraggeber) {
      entry.auftraggeber = r.auftraggeber;
    }
  }

  res.json(Array.from(byBv.values()));
});

// === Detail-Auswertung pro Projekt ===
//
// Liefert die "Excel-ähnliche" Bericht-für-Bericht-Tabelle, die der Kunde
// im Projekte-Dashboard sehen will: pro abgeschlossenen Bericht eine Zeile
// mit Datum, Stunden, Geräten, Tätigkeiten, Entsorgung, Material, Bemerkungen
// und Azubi-Stunden — plus Spaltensummen + Soll/Ist-Vergleich am Ende.

type ProjectDetailReport = {
  id: string;
  datum: string;
  completedAt: string | null;
  gesamtMinuten: number;
  azubiMinuten: number;
  machineMinuten: number;
  machineBreakdown: { name: string; minutes: number }[];
  tasksLines: string[];
  materialVerwendet: string;
  verbrauchsmaterialFahrzeug: string;
  entsorgungKg: number;
  entsorgungBreakdown: { material: string; mengeKg: number }[];
  bemerkungen: string;
};

router.get('/projects/:bvNummer', async (req: Request, res: Response) => {
  const bv = (req.params.bvNummer as string || '').trim();
  if (!bv) { res.status(400).json({ error: 'BV-Nummer erforderlich' }); return; }

  const rows = await db.select().from(reports)
    .where(eq(reports.bvNummer, bv));

  // Nur abgeschlossene Berichte zählen — Drafts sind in der Auswertung störend.
  const completed = rows.filter(r => r.status === 'complete');

  // Sortierung nach Datum aufsteigend (Excel-Stil: ältester Bericht oben).
  // Datum ist als "DD.MM.YYYY"-String gespeichert; wir parsen für stabile Reihenfolge.
  const parseDate = (s: string | null): number => {
    if (!s) return 0;
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!m) return 0;
    return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)).getTime();
  };
  completed.sort((a, b) => parseDate(a.datum) - parseDate(b.datum));

  const reportRows: ProjectDetailReport[] = completed.map(r => {
    const data: any = r.dataJson || {};
    const tasksLines: string[] = Array.isArray(data.tasks)
      ? (data.tasks as string[])
          .flatMap((t: string) => (t || '').split('\n'))
          .map((l: string) => l.trim())
          .filter(Boolean)
      : [];
    // Trivial-Werte ("Kein", "-", "n/a") rausfiltern, damit die Bemerkungen-Spalte
    // nicht mit "Kein\nKein\nKein"-Plattitüden vollläuft, wenn der Bauleiter nichts
    // wirklich Erwähnenswertes eingetragen hat.
    const TRIVIAL = /^(kein|keine|nein|-|—|n\/a|k\.\s*a\.?)$/i;
    const bemerkungenParts = [data.vorkommnisse, data.wasLiefGut, data.wasLiefNichtGut]
      .filter((s: string | undefined) => s && s.trim() && !TRIVIAL.test(s.trim()))
      .join('\n');

    return {
      id: r.id,
      datum: r.datum || '',
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      gesamtMinuten: regularWorkerMinutes(data),
      azubiMinuten: azubiWorkerMinutes(data),
      machineMinuten: machineMinutes(data),
      machineBreakdown: machineBreakdown(data),
      tasksLines,
      materialVerwendet: data.materialVerwendet || '',
      verbrauchsmaterialFahrzeug: data.verbrauchsmaterialFahrzeug || '',
      entsorgungKg: disposalKg(data),
      entsorgungBreakdown: disposalBreakdown(data),
      bemerkungen: bemerkungenParts,
    };
  });

  // Header-Daten aus dem jüngsten Bericht (oder ersten gefundenen).
  const headerSource = completed[completed.length - 1] || rows[0] || null;
  const sollstundenMinuten = Math.max(0, ...completed.map(r => r.sollstundenMinuten || 0));

  const sums = reportRows.reduce(
    (acc, r) => ({
      gesamtMinuten: acc.gesamtMinuten + r.gesamtMinuten,
      azubiMinuten: acc.azubiMinuten + r.azubiMinuten,
      machineMinuten: acc.machineMinuten + r.machineMinuten,
      entsorgungKg: acc.entsorgungKg + r.entsorgungKg,
    }),
    { gesamtMinuten: 0, azubiMinuten: 0, machineMinuten: 0, entsorgungKg: 0 }
  );

  res.json({
    bvNummer: bv,
    projektbezeichnung: headerSource?.projektbezeichnung || '',
    auftraggeber: headerSource?.auftraggeber || '',
    sollstundenMinuten,
    reports: reportRows,
    sums,
    sollMinuten: sollstundenMinuten,
    nochMinuten: sollstundenMinuten - sums.gesamtMinuten,
  });
});

// reportTotalMinutes wird jetzt zwar in der Aggregation oben weiter verwendet,
// liefert intern aber regularWorkerMinutes() — Azubis verfälschen die
// Soll/Ist-Auswertung nicht mehr.
void reportTotalMinutes;

export default router;

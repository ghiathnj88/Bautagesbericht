import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/connection.js';
import { users, auditLog } from '../db/schema.js';
import { config } from '../config.js';
import { eq } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import type { JwtPayload } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

  if (!user || !user.active) {
    res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    return;
  }

  const payload: JwtPayload = {
    userId: user.id,
    username: user.username,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.accessExpiresIn,
  });

  const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });

  // Log the login
  await db.insert(auditLog).values({
    userId: user.id,
    action: 'login',
    detail: `Login erfolgreich: ${user.username}`,
    ipAddress: req.ip,
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: false, // Set to true when using HTTPS in production
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({
    accessToken,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  });
});

router.post('/refresh', async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    res.status(401).json({ error: 'Kein Refresh-Token' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret) as JwtPayload;
    const newAccess = jwt.sign(
      { userId: payload.userId, username: payload.username, role: payload.role },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiresIn }
    );
    res.json({ accessToken: newAccess });
  } catch {
    res.status(401).json({ error: 'Ungültiges Refresh-Token' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('refreshToken');
  res.json({ message: 'Abgemeldet' });
});

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const [user] = await db.select({
    id: users.id,
    username: users.username,
    fullName: users.fullName,
    role: users.role,
  }).from(users).where(eq(users.id, req.user!.userId)).limit(1);

  if (!user) {
    res.status(404).json({ error: 'Benutzer nicht gefunden' });
    return;
  }

  res.json(user);
});

export default router;

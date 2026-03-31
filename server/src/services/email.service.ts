import nodemailer from 'nodemailer';
import path from 'node:path';
import { db } from '../db/connection.js';
import { settings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decrypt } from './crypto.service.js';
import { config } from '../config.js';

interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: { filename: string; path: string }[];
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  if (!row) return null;
  return decrypt(row.valueEncrypted);
}

async function createTransport() {
  const host = await getSetting('smtp_host');
  const port = await getSetting('smtp_port');
  const user = await getSetting('smtp_user');
  const pass = await getSetting('smtp_password');

  if (!host || !user || !pass) {
    throw new Error('SMTP-Einstellungen nicht konfiguriert. Bitte im Admin-Bereich einrichten.');
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port || '587', 10),
    secure: parseInt(port || '587', 10) === 465,
    auth: { user, pass },
  });
}

export async function sendReportEmail(
  to: string,
  reportData: { bvNummer: string; datum: string; bauleiter: string },
  pdfPath: string
) {
  const transport = await createTransport();
  const fromName = await getSetting('smtp_from_name') || 'Patzig GmbH & Co. KG';
  const fromEmail = await getSetting('smtp_user') || 'noreply@patzig.de';

  const absolutePdfPath = path.resolve(config.uploads.dir, pdfPath);

  await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to,
    subject: `Bautagesbericht ${reportData.bvNummer} - ${reportData.datum}`,
    text: `Sehr geehrte Damen und Herren,\n\nanbei finden Sie den Bautagesbericht für ${reportData.datum}.\n\nBV-Nummer: ${reportData.bvNummer}\nBauleiter: ${reportData.bauleiter}\n\nMit freundlichen Grüßen\nPatzig GmbH & Co. KG`,
    html: `<p>Sehr geehrte Damen und Herren,</p>
<p>anbei finden Sie den Bautagesbericht für <strong>${reportData.datum}</strong>.</p>
<p>BV-Nummer: ${reportData.bvNummer}<br>Bauleiter: ${reportData.bauleiter}</p>
<p>Mit freundlichen Grüßen<br><strong>Patzig GmbH &amp; Co. KG</strong></p>`,
    attachments: [
      { filename: `Bautagesbericht_${reportData.bvNummer}_${reportData.datum}.pdf`, path: absolutePdfPath },
    ],
  });
}

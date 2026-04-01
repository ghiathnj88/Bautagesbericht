import puppeteer from 'puppeteer';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { config } from '../config.js';

interface PdfReportData {
  bvNummer: string;
  kundennummer?: string;
  auftraggeber: string;
  lieferanschrift: string;
  datum: string;
  bauleiter: string;
  bauleiterAnfang: string;
  bauleiterEnde: string;
  bauleiterPause: string;
  workers: { name: string; anfang: string; ende: string; pause: string }[];
  tasks: string[];
  materialVerwendet: string;
  verbrauchsmaterialFahrzeug: string;
  machines: { name: string; durationHours: number; durationMinutes: number }[];
  muellBauschutt: string;
  weather?: { temperature: string; condition: string; wind: string; humidity: string; loaded: boolean };
  vorkommnisse: string;
  wasLiefGut: string;
  wasLiefNichtGut: string;
  customerEmail: string;
  signatureBauleiter?: string;
  signatureCustomer?: string;
  photoBase64s?: string[]; // base64 data URIs of uploaded photos
}

function esc(str: string | undefined | null): string {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(data: PdfReportData): string {
  const tasksHtml = (data.tasks || []).filter(t => t && t.trim()).map(t => `<li>${esc(t)}</li>`).join('');

  const workersHtml = (data.workers || []).map(w =>
    `<tr><td>${esc(w.name)}</td><td>${esc(w.anfang)}</td><td>${esc(w.ende)}</td><td>${esc(w.pause)}</td></tr>`
  ).join('');

  const machinesHtml = (data.machines || []).length > 0
    ? `<table><tr><th>Maschine</th><th>Einsatzdauer</th></tr>
       ${data.machines.map(m => `<tr><td>${esc(m.name)}</td><td>${m.durationHours}h ${m.durationMinutes}min</td></tr>`).join('')}
       </table>`
    : '';

  const weatherHtml = data.weather?.loaded
    ? `<table>
        <tr><td><strong>Temperatur</strong></td><td>${esc(data.weather.temperature)}</td>
            <td><strong>Wind</strong></td><td>${esc(data.weather.wind)}</td></tr>
        <tr><td><strong>Bedingung</strong></td><td>${esc(data.weather.condition)}</td>
            <td><strong>Luftfeuchtigkeit</strong></td><td>${esc(data.weather.humidity)}</td></tr>
       </table>`
    : '<p class="muted">Keine Wetterdaten</p>';

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; color: #333; margin: 30px; }
  h1 { font-size: 18px; color: #C0392B; border-bottom: 2px solid #C0392B; padding-bottom: 6px; }
  h2 { font-size: 13px; color: #555; margin-top: 18px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  .header-info { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .header-info div { font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; font-size: 10px; }
  th { background: #f5f5f5; font-weight: 600; }
  .muted { color: #999; font-style: italic; }
  .text-block { white-space: pre-wrap; margin: 4px 0; }
  .signature-box { display: inline-block; width: 45%; text-align: center; margin-top: 20px; }
  .signature-box img { max-height: 60px; }
  .signature-label { border-top: 1px solid #333; margin-top: 4px; padding-top: 4px; font-size: 10px; }
  .company { font-size: 9px; color: #999; text-align: right; }
</style>
</head>
<body>
  <p class="company">Patzig GmbH &amp; Co. KG</p>
  <h1>Bautagesbericht</h1>

  <div class="header-info">
    <div><strong>BV-Nr.:</strong> ${esc(data.bvNummer)}${data.kundennummer ? ` &nbsp; <strong>Kd-Nr.:</strong> ${esc(data.kundennummer)}` : ''}</div>
    <div><strong>Datum:</strong> ${esc(data.datum)}</div>
  </div>
  <div class="header-info">
    <div><strong>Auftraggeber:</strong> ${esc(data.auftraggeber)}</div>
  </div>
  <div><strong>Lieferanschrift:</strong> ${esc(data.lieferanschrift)}</div>

  <h2>Personal</h2>
  <table>
    <tr><th>Name</th><th>Anfang</th><th>Ende</th><th>Pause</th></tr>
    <tr><td><strong>${esc(data.bauleiter)} (Bauleiter)</strong></td><td>${esc(data.bauleiterAnfang)}</td><td>${esc(data.bauleiterEnde)}</td><td>${esc(data.bauleiterPause)}</td></tr>
    ${workersHtml}
  </table>

  <h2>Ausgeführte Arbeiten</h2>
  ${tasksHtml ? `<ol>${tasksHtml}</ol>` : '<p class="muted">Keine Angaben</p>'}

  <h2>Material</h2>
  <p><strong>Verwendetes Material:</strong></p>
  ${data.materialVerwendet ? `<p class="text-block">${esc(data.materialVerwendet)}</p>` : '<p class="muted">-</p>'}
  ${data.verbrauchsmaterialFahrzeug ? `<p><strong>Verbrauchsmaterial Fahrzeug:</strong></p><p class="text-block">${esc(data.verbrauchsmaterialFahrzeug)}</p>` : ''}

  ${machinesHtml ? `<h2>Geräte</h2>${machinesHtml}` : ''}

  ${data.muellBauschutt ? `<h2>Entsorgung</h2><p class="text-block">${esc(data.muellBauschutt)}</p>` : ''}

  ${(data.photoBase64s && data.photoBase64s.length > 0) ? `
  <h2>Fotos (${data.photoBase64s.length})</h2>
  <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">
    ${data.photoBase64s.map(b64 => `<img src="${b64}" style="width:160px;height:120px;object-fit:cover;border:1px solid #ddd;border-radius:4px;" />`).join('')}
  </div>` : ''}

  <h2>Wetter</h2>
  ${weatherHtml}

  <h2>Bemerkungen</h2>
  ${data.vorkommnisse ? `<p><strong>Vorkommnisse:</strong></p><p class="text-block">${esc(data.vorkommnisse)}</p>` : ''}
  ${data.wasLiefGut ? `<p><strong>Was lief gut:</strong></p><p class="text-block">${esc(data.wasLiefGut)}</p>` : ''}
  ${data.wasLiefNichtGut ? `<p><strong>Was lief nicht gut:</strong></p><p class="text-block">${esc(data.wasLiefNichtGut)}</p>` : ''}
  ${!data.vorkommnisse && !data.wasLiefGut && !data.wasLiefNichtGut ? '<p class="muted">Keine Bemerkungen</p>' : ''}

  <div style="margin-top: 30px;">
    <div class="signature-box">
      ${data.signatureBauleiter ? `<img src="${data.signatureBauleiter}" />` : '<div style="height:60px"></div>'}
      <div class="signature-label">Bauleiter: ${esc(data.bauleiter)}</div>
    </div>
    <div class="signature-box" style="margin-left:8%;">
      ${data.signatureCustomer ? `<img src="${data.signatureCustomer}" />` : '<div style="height:60px"></div>'}
      <div class="signature-label">Kunde</div>
    </div>
  </div>
</body>
</html>`;
}

export async function generatePdf(reportId: string, data: PdfReportData): Promise<string> {
  const dir = path.resolve(config.uploads.dir, 'pdfs');
  await mkdir(dir, { recursive: true });

  const filename = `bautagesbericht_${data.bvNummer || reportId}_${data.datum?.replace(/\./g, '-') || 'unknown'}.pdf`;
  const filePath = path.join(dir, filename);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(data), { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }

  return `pdfs/${filename}`;
}

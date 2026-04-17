import puppeteer from 'puppeteer';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, '../../assets/patzig-logo.png');
let logoDataUri = '';
try {
  const buf = readFileSync(logoPath);
  logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
} catch {
  console.warn('[PDF] Logo nicht gefunden:', logoPath);
}

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
  entsorgung?: { material: string; menge: string }[];
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
  const tasksHtml = (data.tasks || [])
    .flatMap(t => (t || '').split('\n'))
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => `<li>${esc(l)}</li>`)
    .join('');

  const workersHtml = (data.workers || []).map(w =>
    `<tr><td>${esc(w.name)}</td><td>${esc(w.anfang)}</td><td>${esc(w.ende)}</td><td>${esc(w.pause)}</td></tr>`
  ).join('');

  const PHOTOS_PER_PAGE = 6;
  const photoGroups: string[][] = [];
  for (let i = 0; i < (data.photoBase64s?.length || 0); i += PHOTOS_PER_PAGE) {
    photoGroups.push(data.photoBase64s!.slice(i, i + PHOTOS_PER_PAGE));
  }
  const photosHtml = photoGroups.length > 0
    ? `<div class="photos-section">
         <h2>Fotos (${data.photoBase64s!.length})</h2>
         ${photoGroups.map(group => `
           <div class="photo-page-group">
             <div class="photo-grid">
               ${group.map(b64 => `<img src="${b64}" />`).join('')}
             </div>
           </div>
         `).join('')}
       </div>`
    : '';

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
  .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .report-header .logo { height: 60px; }
  .company { font-size: 9px; color: #999; text-align: right; }
  .photo-page-group { page-break-inside: avoid; page-break-after: always; margin-top: 6px; }
  .photos-section .photo-page-group:last-of-type { page-break-after: auto; }
  .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 4mm; }
  .photo-grid img { width: 100%; height: 80mm; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; }
</style>
</head>
<body>
  <div class="report-header">
    <h1 style="margin:0;">Bautagesbericht</h1>
    ${logoDataUri ? `<img src="${logoDataUri}" class="logo" alt="Patzig Logo" />` : '<p class="company">Patzig GmbH &amp; Co. KG</p>'}
  </div>

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

  ${(data.entsorgung && data.entsorgung.length > 0)
    ? `<h2>Entsorgung</h2>
       <table><tr><th>Material</th><th>Menge</th></tr>
       ${data.entsorgung.map(e => `<tr><td>${esc(e.material)}</td><td>${esc(e.menge)}</td></tr>`).join('')}
       </table>`
    : (data.muellBauschutt ? `<h2>Entsorgung</h2><p class="text-block">${esc(data.muellBauschutt)}</p>` : '')}

  <h2>Wetter</h2>
  ${weatherHtml}

  <h2>Bemerkungen</h2>
  ${data.vorkommnisse ? `<p><strong>Vorkommnisse:</strong></p><p class="text-block">${esc(data.vorkommnisse)}</p>` : ''}
  ${data.wasLiefGut ? `<p><strong>Was lief gut:</strong></p><p class="text-block">${esc(data.wasLiefGut)}</p>` : ''}
  ${data.wasLiefNichtGut ? `<p><strong>Was lief nicht gut:</strong></p><p class="text-block">${esc(data.wasLiefNichtGut)}</p>` : ''}
  ${!data.vorkommnisse && !data.wasLiefGut && !data.wasLiefNichtGut ? '<p class="muted">Keine Bemerkungen</p>' : ''}

  ${photosHtml}

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

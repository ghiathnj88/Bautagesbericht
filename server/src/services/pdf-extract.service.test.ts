import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  extractProjektzeitMinutes,
  extractProjektbezeichnung,
  extractPatzigArbeitsauftrag,
  extractArbeitsauftragFields,
  formatYyMmDd,
} from './pdf-extract.service.js';

describe('extractProjektzeitMinutes', () => {
  it('parst "158:0 Std" korrekt', () => {
    expect(extractProjektzeitMinutes('Projektzeit : 158:0 Std')).toBe(9480);
    expect(extractProjektzeitMinutes('Projektzeit: 158:0 Std.')).toBe(9480);
    expect(extractProjektzeitMinutes('Projektzeit : 8:30 Std')).toBe(510);
  });

  it('liefert null wenn nicht gefunden', () => {
    expect(extractProjektzeitMinutes('')).toBeNull();
    expect(extractProjektzeitMinutes('keine Projektzeit hier')).toBeNull();
    expect(extractProjektzeitMinutes('Projektzeit : ungültig Std')).toBeNull();
  });
});

describe('extractProjektbezeichnung', () => {
  it('extrahiert einzeilige Bezeichnung', () => {
    const text = 'Projektbezeichnung : Fassadenmontage 8 Fenster\nProjektzeit : 158:0 Std';
    expect(extractProjektbezeichnung(text)).toBe('Fassadenmontage 8 Fenster');
  });

  it('extrahiert mehrzeilige Bezeichnung bis zum nächsten Label', () => {
    const text =
      'Projektbezeichnung : Erste Zeile\nzweite Zeile\nProjektzeit : 100:0 Std';
    expect(extractProjektbezeichnung(text)).toBe('Erste Zeile zweite Zeile');
  });

  it('liefert leeren String wenn nicht gefunden', () => {
    expect(extractProjektbezeichnung('Anderer Text')).toBe('');
    expect(extractProjektbezeichnung('')).toBe('');
  });
});

describe('extractPatzigArbeitsauftrag — echte Patzig-Datei', () => {
  it('liefert null wenn kein Arbeitsauftrag-Marker', () => {
    expect(extractPatzigArbeitsauftrag('Irgend ein Text')).toBeNull();
  });

  it('extrahiert alle Felder aus dem echten Patzig-PDF', async () => {
    const pdfPath = path.resolve(
      __dirname,
      '../../../ftp-seed/87922_HSW_Klauss_Stuttgart/Monteur/Arbeitsauftrag_200003563.pdf'
    );

    let buf: Buffer;
    try {
      buf = await readFile(pdfPath);
    } catch {
      // Datei ist nicht eingecheckt (siehe .gitignore). Test wird in CI
      // übersprungen — pure Unit-Tests laufen auch ohne Fixture.
      console.warn(`[Test] Patzig-PDF nicht gefunden, Test übersprungen: ${pdfPath}`);
      return;
    }

    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buf);
    const extracted = extractPatzigArbeitsauftrag(result.text);

    expect(extracted).not.toBeNull();
    expect(extracted!.bvNummer).toBe('201487489');
    expect(extracted!.kundennummer).toBe('201313552');
    expect(extracted!.sollstundenMinuten).toBe('9480');
    expect(extracted!.projektbezeichnung).toBe(
      'Fasadenplattenmontage im 1/4/7 OG an 8 Fenstern anschließen'
    );
    expect(extracted!.auftraggeber).toContain('SW Verwaltungsgesellschaft mbH');
    expect(extracted!.lieferanschrift).toContain('Objekt 24046');
  });
});

describe('extractArbeitsauftragFields — Fallback', () => {
  it('nutzt generische Label-Logik wenn Patzig-Format fehlt', () => {
    const text = 'Auftraggeber: Mustermann GmbH\nLieferanschrift: Musterstr 1\nBV-Nr: 12345';
    const result = extractArbeitsauftragFields(text);
    expect(result.auftraggeber).toBe('Mustermann GmbH');
    expect(result.bvNummer).toBe('12345');
  });
});

describe('formatYyMmDd', () => {
  it('formatiert deutsches Datum als YY-MM-DD', () => {
    expect(formatYyMmDd('28.04.2026')).toBe('26-04-28');
    expect(formatYyMmDd('01.01.2025')).toBe('25-01-01');
    expect(formatYyMmDd('9.4.2026')).toBe('26-04-09'); // einstellig wird gepadded
  });

  it('Fallback auf heute bei ungültiger Eingabe', () => {
    const today = formatYyMmDd('');
    expect(today).toMatch(/^\d{2}-\d{2}-\d{2}$/);
    expect(formatYyMmDd(null)).toMatch(/^\d{2}-\d{2}-\d{2}$/);
    expect(formatYyMmDd('Quatsch')).toMatch(/^\d{2}-\d{2}-\d{2}$/);
  });
});

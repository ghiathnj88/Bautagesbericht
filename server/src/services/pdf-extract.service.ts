// PDF-Extraktor für Patzig-Arbeitsauftrag-PDFs.
//
// Reine Funktionen ohne externe Abhängigkeiten (außer pdf-parse, was dynamisch
// im Aufrufer importiert wird). Alle Funktionen sind synchron und arbeiten auf
// dem bereits extrahierten Text — sie lassen sich damit ohne PDF-Fixture testen.
//
// Kontext: pdf-parse zerlegt die rechte Tabelle des Patzig-Arbeitsauftrags so,
// dass Werte (Zeilen die mit ":" beginnen) und Labels nicht mehr zusammen stehen.
// Heuristik: zwei Zahlen-Werte vor dem Datum (= Auftragsnummer + Projektnr),
// Datum als DD.MM.YYYY, eine Zahl nach dem Datum (= Kundennr).
// Adressblock liegt zwischen "Original" und der ersten Zeile mit "<DD.MM.YYYY".

// "Projektzeit : 158:0 Std" → 9480 Minuten. Toleriert beliebige Whitespace-Varianten.
export function extractProjektzeitMinutes(text: string): number | null {
  const m = text.match(/Projektzeit\s*:\s*(\d+)\s*:\s*(\d+)\s*Std/i);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

// "Projektbezeichnung : <Beschreibung>" → Beschreibung. Sammelt Folgezeilen,
// bis das nächste Label ("X :") oder die nächste Tabellenwert-Zeile (": value")
// kommt.
export function extractProjektbezeichnung(text: string): string {
  const lines = text.split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Projektbezeichnung\s*:\s*(.*)$/i);
    if (!m) continue;
    let result = m[1];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!line) continue;
      if (/^[A-ZÄÖÜa-zäöüß][\wÄÖÜäöüß. \-/()]*\s*:\s/.test(line)) break;
      if (/^:\s/.test(line)) break;
      result += ' ' + line;
    }
    return result.trim().replace(/\s+/g, ' ');
  }
  return '';
}

export function extractPatzigArbeitsauftrag(text: string): Record<string, string> | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.includes('Arbeitsauftrag')) return null;

  type ColonValue = { lineIdx: number; arrIdx: number; value: string };
  const colonValues: ColonValue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^:\s*(.+)$/);
    if (m && m[1].trim()) {
      colonValues.push({ lineIdx: i, arrIdx: colonValues.length, value: m[1].trim() });
    }
  }

  const result: Record<string, string> = {
    auftraggeber: '',
    lieferanschrift: '',
    bvNummer: '',
    kundennummer: '',
    projektbezeichnung: '',
    sollstundenMinuten: '',
  };

  const projektzeit = extractProjektzeitMinutes(text);
  if (projektzeit !== null) result.sollstundenMinuten = String(projektzeit);

  const bezeichnung = extractProjektbezeichnung(text);
  if (bezeichnung) result.projektbezeichnung = bezeichnung;

  // Inline-Labels haben Vorrang ("Projektnr. : 201487489").
  const projektnrInline = text.match(/Projektnr\.?\s*:\s*(\d+)/i);
  if (projektnrInline) result.bvNummer = projektnrInline[1];
  const kundennrInline = text.match(/Kundennr\.?\s*:\s*(\d+)/i);
  if (kundennrInline) result.kundennummer = kundennrInline[1];

  // Fallback: Datum-Anchor in den Colon-Values
  const dateIdx = colonValues.findIndex((v) => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v.value));
  if (dateIdx >= 0) {
    const numsBefore = colonValues.slice(0, dateIdx).filter((v) => /^\d+$/.test(v.value));
    const numsAfter = colonValues.slice(dateIdx + 1).filter((v) => /^\d+$/.test(v.value));
    if (!result.bvNummer) {
      if (numsBefore.length >= 2) {
        result.bvNummer = numsBefore[1].value;
      } else if (numsBefore.length === 1) {
        result.bvNummer = numsBefore[0].value;
      }
    }
    if (!result.kundennummer && numsAfter.length >= 1) {
      result.kundennummer = numsAfter[0].value;
    }
  }

  // Adressblock: zwischen "Original" und der nächsten ":-Wert"-Zeile.
  const tableLabels = new Set(['Projektnr.', 'Kundennr.', 'Datum', 'Nummer']);
  const addressLines: string[] = [];
  let inAddress = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === 'Original') {
      inAddress = true;
      continue;
    }
    if (!inAddress) continue;
    if (/^:\s/.test(line)) break;
    if (tableLabels.has(line)) continue;
    addressLines.push(line);
  }

  // Zeilen, die mit "+" enden, gehören zur nächsten zusammen (visueller Umbruch).
  const merged: string[] = [];
  for (let i = 0; i < addressLines.length; i++) {
    let l = addressLines[i];
    while (l.endsWith('+') && i + 1 < addressLines.length) {
      l = l.replace(/\s*\+\s*$/, ' ') + addressLines[++i];
    }
    merged.push(l.trim());
  }

  // "c/o" trennt Lieferanschrift (Baustelle) und Auftraggeber (Rechnungsempfänger).
  const cIoIdx = merged.findIndex((l) => /^c\/o\b/i.test(l));
  if (cIoIdx >= 0) {
    result.lieferanschrift = merged.slice(0, cIoIdx).join(', ');
    result.auftraggeber = merged.slice(cIoIdx).map((l) => l.replace(/^c\/o\s*/i, '')).join(', ');
  } else if (merged.length > 0) {
    result.lieferanschrift = merged.join(', ');
  }

  return result;
}

export function extractArbeitsauftragFields(text: string): Record<string, string> {
  // Patzig-spezifisches Format zuerst versuchen.
  const patzig = extractPatzigArbeitsauftrag(text);
  if (patzig && (patzig.bvNummer || patzig.lieferanschrift || patzig.auftraggeber)) {
    return patzig;
  }

  // Fallback: generische Label-auf-Zeile-Logik.
  const extracted: Record<string, string> = {
    auftraggeber: '',
    lieferanschrift: '',
    bvNummer: '',
    kundennummer: '',
    projektbezeichnung: '',
    sollstundenMinuten: '',
  };

  const projektzeit = extractProjektzeitMinutes(text);
  if (projektzeit !== null) extracted.sollstundenMinuten = String(projektzeit);

  const bezeichnung = extractProjektbezeichnung(text);
  if (bezeichnung) extracted.projektbezeichnung = bezeichnung;

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
  return extracted;
}

// "DD.MM.YYYY" → "YY-MM-DD". Ohne Match: Fallback auf heutiges Datum.
export function formatYyMmDd(datum: string | undefined | null): string {
  const m = (datum || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y.slice(-2)}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const now = new Date();
  return `${String(now.getFullYear()).slice(-2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

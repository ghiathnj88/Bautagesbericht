// Hilfsfunktionen für Stunden-/Minuten-Berechnungen aus den Wizard-Strings.
// Die Felder im Bautagesbericht sind als Strings gespeichert ("HH:MM",
// "HH:MM-HH:MM"), weil sie aus dem Formular direkt übernommen werden.

export function parseHHMMtoMinutes(s: string | null | undefined): number {
  if (!s) return 0;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return 0;
  return h * 60 + min;
}

// "12:00-12:30" → 30. Akzeptiert auch reine Minuten-Angaben "30" als Fallback.
export function parsePauseRange(s: string | null | undefined): number {
  if (!s) return 0;
  const trimmed = s.trim();
  const range = trimmed.match(/^(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})$/);
  if (range) {
    const start = parseHHMMtoMinutes(range[1]);
    const end = parseHHMMtoMinutes(range[2]);
    const diff = end - start;
    return diff > 0 ? diff : 0;
  }
  // Fallback: "30" oder "30 min"
  const minutes = trimmed.match(/^(\d+)\s*(?:min)?$/i);
  if (minutes) {
    const m = parseInt(minutes[1], 10);
    return Number.isNaN(m) ? 0 : m;
  }
  return 0;
}

// Berechnet die geleisteten Minuten eines einzelnen Mitarbeiter-Eintrags
// (Bauleiter oder Worker): Ende − Anfang − Pause. Negative Werte werden zu 0.
export function workerMinutes(entry: {
  anfang?: string | null;
  ende?: string | null;
  pause?: string | null;
}): number {
  const start = parseHHMMtoMinutes(entry.anfang);
  const end = parseHHMMtoMinutes(entry.ende);
  if (start === 0 && end === 0) return 0;
  const pause = parsePauseRange(entry.pause);
  const diff = end - start - pause;
  return diff > 0 ? diff : 0;
}

// Reguläre Stunden eines Berichts = Bauleiter + Worker mit azubi=false.
// Ist die Grundlage für den Soll/Ist-Vergleich im Projekt-Dashboard.
export function regularWorkerMinutes(data: any): number {
  if (!data) return 0;
  let total = workerMinutes({
    anfang: data.bauleiterAnfang,
    ende: data.bauleiterEnde,
    pause: data.bauleiterPause,
  });
  if (Array.isArray(data.workers)) {
    for (const w of data.workers) {
      if (!w?.azubi) total += workerMinutes(w);
    }
  }
  return total;
}

// Azubi-Stunden eines Berichts = nur Worker mit azubi=true.
export function azubiWorkerMinutes(data: any): number {
  if (!data || !Array.isArray(data.workers)) return 0;
  let total = 0;
  for (const w of data.workers) {
    if (w?.azubi) total += workerMinutes(w);
  }
  return total;
}

// Backwards-Compat: Bestehende Aufrufer rufen weiterhin reportTotalMinutes() auf
// und bekommen die regulären Stunden — Azubis werden nicht mehr automatisch
// mitgezählt, was die Soll/Ist-Auswertung sauber hält.
export function reportTotalMinutes(data: any): number {
  return regularWorkerMinutes(data);
}

// Geräte-Zeit eines Berichts: Summe aller `machines[]` in Minuten.
export function machineMinutes(data: any): number {
  if (!data || !Array.isArray(data.machines)) return 0;
  let total = 0;
  for (const m of data.machines) {
    const h = Number(m?.durationHours) || 0;
    const min = Number(m?.durationMinutes) || 0;
    total += h * 60 + min;
  }
  return total;
}

// Aufschlüsselung der Geräte-Zeit pro Maschine — wird vom Detail-Endpoint
// genutzt, damit das Frontend pro Bericht "Kran 3:00, Hubst. 2:30" rendern kann.
export function machineBreakdown(data: any): { name: string; minutes: number }[] {
  if (!data || !Array.isArray(data.machines)) return [];
  const out: { name: string; minutes: number }[] = [];
  for (const m of data.machines) {
    const name = (m?.name || '').toString().trim();
    if (!name) continue;
    const h = Number(m?.durationHours) || 0;
    const min = Number(m?.durationMinutes) || 0;
    const minutes = h * 60 + min;
    if (minutes > 0) out.push({ name, minutes });
  }
  return out;
}

// Gesamt-Entsorgungs-Menge in kg. Tolerant für Bestandsdaten, in denen
// `entsorgung[].menge` als Freitext (z.B. "5 kg" oder "etwa 10") gespeichert
// wurde — parseFloat extrahiert die führende Zahl, NaN wird zu 0.
export function disposalKg(data: any): number {
  if (!data || !Array.isArray(data.entsorgung)) return 0;
  let total = 0;
  for (const e of data.entsorgung) {
    const v = e?.mengeKg;
    if (typeof v === 'number' && !Number.isNaN(v)) {
      total += v;
    } else if (typeof e?.menge === 'string') {
      const parsed = parseFloat(e.menge);
      if (!Number.isNaN(parsed)) total += parsed;
    }
  }
  return total;
}

export function disposalBreakdown(data: any): { material: string; mengeKg: number }[] {
  if (!data || !Array.isArray(data.entsorgung)) return [];
  const out: { material: string; mengeKg: number }[] = [];
  for (const e of data.entsorgung) {
    const material = (e?.material || '').toString().trim();
    if (!material) continue;
    let mengeKg = 0;
    if (typeof e?.mengeKg === 'number' && !Number.isNaN(e.mengeKg)) {
      mengeKg = e.mengeKg;
    } else if (typeof e?.menge === 'string') {
      const parsed = parseFloat(e.menge);
      if (!Number.isNaN(parsed)) mengeKg = parsed;
    }
    out.push({ material, mengeKg });
  }
  return out;
}

export function formatMinutesAsHHMM(minutes: number): string {
  if (!minutes || minutes < 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

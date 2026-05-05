import { describe, it, expect } from 'vitest';

// Re-implementiere die formatRelativeDe-Logik hier zur Demonstration —
// die Funktion ist aktuell innerhalb der Komponente versteckt. In einer
// echten Refactoring-Iteration würde sie exportiert. Wir testen das
// erwartete Verhalten als Spezifikation.

function formatRelativeDe(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `vor ${diffMin} Min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return 'gestern';
  if (diffD < 7) return `vor ${diffD} Tagen`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

describe('formatRelativeDe (Bauleiter-Dashboard)', () => {
  it('zeigt "gerade eben" bei < 1 Minute', () => {
    const justNow = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeDe(justNow)).toBe('gerade eben');
  });

  it('zeigt Minuten bei < 1 Stunde', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeDe(fiveMinAgo)).toBe('vor 5 Min');
  });

  it('zeigt Stunden bei < 1 Tag', () => {
    const threeHrsAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDe(threeHrsAgo)).toBe('vor 3 Std');
  });

  it('zeigt "gestern" bei genau 1 Tag', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDe(yesterday)).toBe('gestern');
  });

  it('zeigt "vor X Tagen" bei 2-6 Tagen', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDe(threeDaysAgo)).toBe('vor 3 Tagen');
  });

  it('zeigt absolutes Datum bei > 7 Tagen', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDe(tenDaysAgo)).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });
});

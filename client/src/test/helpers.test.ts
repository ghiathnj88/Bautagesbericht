// Pure-Function-Tests für die Helper, die wir aktuell innerhalb der Komponenten
// haben. Die Implementierungen sind hier 1:1 reproduziert — bei einem späteren
// Refactor sollten sie als utils ausgelagert und von Komponenten + Tests
// gemeinsam importiert werden.

import { describe, it, expect } from 'vitest';

function formatHHMM(minutes: number): string {
  if (!minutes || minutes < 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function formatKg(n: number): string {
  if (!n) return '0';
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

describe('formatHHMM', () => {
  it('formatiert Stunden + Minuten', () => {
    expect(formatHHMM(0)).toBe('0:00');
    expect(formatHHMM(60)).toBe('1:00');
    expect(formatHHMM(90)).toBe('1:30');
    expect(formatHHMM(125)).toBe('2:05');
    expect(formatHHMM(510)).toBe('8:30');
  });

  it('Edge-Cases: NaN, negativ', () => {
    expect(formatHHMM(NaN)).toBe('0:00');
    expect(formatHHMM(-15)).toBe('0:00');
  });
});

describe('formatKg', () => {
  it('ganze Zahlen ohne Komma', () => {
    expect(formatKg(0)).toBe('0');
    expect(formatKg(2)).toBe('2');
    expect(formatKg(100)).toBe('100');
  });

  it('Dezimalzahlen mit einer Nachkommastelle', () => {
    expect(formatKg(1.5)).toBe('1.5');
    expect(formatKg(0.7)).toBe('0.7');
    expect(formatKg(50.25)).toBe('50.3'); // gerundet auf 1 Stelle
  });
});

import { describe, it, expect } from 'vitest';
import {
  parseHHMMtoMinutes,
  parsePauseRange,
  workerMinutes,
  regularWorkerMinutes,
  azubiWorkerMinutes,
  machineMinutes,
  machineBreakdown,
  disposalKg,
  disposalBreakdown,
  formatMinutesAsHHMM,
  reportTotalMinutes,
} from './time.js';

describe('parseHHMMtoMinutes', () => {
  it('parst gültige Zeiten korrekt', () => {
    expect(parseHHMMtoMinutes('07:30')).toBe(450);
    expect(parseHHMMtoMinutes('00:00')).toBe(0);
    expect(parseHHMMtoMinutes('23:59')).toBe(23 * 60 + 59);
    expect(parseHHMMtoMinutes('9:05')).toBe(9 * 60 + 5);
  });

  it('liefert 0 für leere/ungültige Eingaben', () => {
    expect(parseHHMMtoMinutes(null)).toBe(0);
    expect(parseHHMMtoMinutes(undefined)).toBe(0);
    expect(parseHHMMtoMinutes('')).toBe(0);
    expect(parseHHMMtoMinutes('abc')).toBe(0);
    expect(parseHHMMtoMinutes('25:00')).toBe(25 * 60); // technisch kein Cap
  });
});

describe('parsePauseRange', () => {
  it('rechnet Range-Format', () => {
    expect(parsePauseRange('12:00-12:30')).toBe(30);
    expect(parsePauseRange('12:00–13:00')).toBe(60); // en-dash
    expect(parsePauseRange('11:30—12:30')).toBe(60); // em-dash
  });

  it('akzeptiert reine Zahlen als Minuten', () => {
    expect(parsePauseRange('30')).toBe(30);
    expect(parsePauseRange('45 min')).toBe(45);
  });

  it('liefert 0 für Nonsens', () => {
    expect(parsePauseRange('')).toBe(0);
    expect(parsePauseRange(null)).toBe(0);
    expect(parsePauseRange('Mittagspause')).toBe(0);
    expect(parsePauseRange('14:00-13:00')).toBe(0); // negativ → 0
  });
});

describe('workerMinutes', () => {
  it('berechnet Differenz mit Pause', () => {
    expect(workerMinutes({ anfang: '07:00', ende: '16:00', pause: '12:00-12:30' })).toBe(510);
  });

  it('akzeptiert leere Pause', () => {
    expect(workerMinutes({ anfang: '08:00', ende: '12:00', pause: '' })).toBe(240);
  });

  it('liefert 0 wenn Ende vor Anfang', () => {
    expect(workerMinutes({ anfang: '16:00', ende: '07:00', pause: '' })).toBe(0);
  });

  it('liefert 0 bei fehlenden Werten', () => {
    expect(workerMinutes({})).toBe(0);
    expect(workerMinutes({ anfang: '07:00' })).toBe(0);
  });
});

describe('regularWorkerMinutes / azubiWorkerMinutes', () => {
  const sample = {
    bauleiterAnfang: '07:00',
    bauleiterEnde: '16:00',
    bauleiterPause: '12:00-12:30',
    workers: [
      { name: 'A', anfang: '07:00', ende: '16:00', pause: '12:00-12:30', azubi: false },
      { name: 'Azubi B', anfang: '08:00', ende: '14:00', pause: '12:00-12:30', azubi: true },
    ],
  };

  it('regular zählt Bauleiter + Nicht-Azubi-Worker', () => {
    expect(regularWorkerMinutes(sample)).toBe(510 + 510);
  });

  it('azubi zählt nur Worker mit azubi=true', () => {
    expect(azubiWorkerMinutes(sample)).toBe(6 * 60 - 30); // 5:30
  });

  it('reportTotalMinutes ist alias auf regular', () => {
    expect(reportTotalMinutes(sample)).toBe(regularWorkerMinutes(sample));
  });

  it('handhabt leere/null-Daten', () => {
    expect(regularWorkerMinutes(null)).toBe(0);
    expect(azubiWorkerMinutes(null)).toBe(0);
    expect(regularWorkerMinutes({})).toBe(0);
  });
});

describe('machineMinutes / machineBreakdown', () => {
  const data = {
    machines: [
      { name: 'Kran', durationHours: 3, durationMinutes: 0 },
      { name: 'Hubsteiger', durationHours: 0, durationMinutes: 30 },
      { name: '', durationHours: 1, durationMinutes: 0 }, // ohne Name → wird vom Breakdown ignoriert
    ],
  };

  it('summiert alle Maschinen-Zeiten', () => {
    expect(machineMinutes(data)).toBe(3 * 60 + 30 + 60);
  });

  it('breakdown enthält nur benannte Maschinen mit Zeit', () => {
    const out = machineBreakdown(data);
    expect(out).toEqual([
      { name: 'Kran', minutes: 180 },
      { name: 'Hubsteiger', minutes: 30 },
    ]);
  });

  it('liefert 0/leer für leere Listen', () => {
    expect(machineMinutes({})).toBe(0);
    expect(machineBreakdown({})).toEqual([]);
  });
});

describe('disposalKg / disposalBreakdown', () => {
  it('summiert numerische Mengen', () => {
    const data = {
      entsorgung: [
        { material: 'Bauschutt', mengeKg: 200 },
        { material: 'Asbest', mengeKg: 50.5 },
      ],
    };
    expect(disposalKg(data)).toBe(250.5);
    expect(disposalBreakdown(data)).toEqual([
      { material: 'Bauschutt', mengeKg: 200 },
      { material: 'Asbest', mengeKg: 50.5 },
    ]);
  });

  it('Backwards-Compat: Freitext-Mengen werden via parseFloat geparst', () => {
    // parseFloat liest nur führende Zahlen — "5 kg" → 5, "etwa 10" → NaN → 0.
    const data = {
      entsorgung: [
        { material: 'Mineralwolle', menge: '5 kg' },
        { material: 'Holz', menge: '10kg' },
        { material: 'Müll', menge: 'etwa 7' }, // führendes Wort → NaN → 0
      ],
    };
    expect(disposalKg(data)).toBe(15);
  });

  it('liefert 0/leer für leere Listen', () => {
    expect(disposalKg({})).toBe(0);
    expect(disposalBreakdown({})).toEqual([]);
  });
});

describe('formatMinutesAsHHMM', () => {
  it('formatiert ganze Stunden', () => {
    expect(formatMinutesAsHHMM(60)).toBe('1:00');
    expect(formatMinutesAsHHMM(120)).toBe('2:00');
  });

  it('formatiert Stunden + Minuten', () => {
    expect(formatMinutesAsHHMM(90)).toBe('1:30');
    expect(formatMinutesAsHHMM(125)).toBe('2:05');
  });

  it('Edge-Cases', () => {
    expect(formatMinutesAsHHMM(0)).toBe('0:00');
    expect(formatMinutesAsHHMM(-10)).toBe('0:00');
    expect(formatMinutesAsHHMM(NaN)).toBe('0:00');
  });
});

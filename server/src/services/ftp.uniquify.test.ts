import { describe, it, expect } from 'vitest';
import { uniquifyName } from './ftp.service.js';

// Mock-FTP-Client: hat nur die `list()`-Methode, die uniquifyName aufruft.
function makeMockClient(existingNames: string[]): any {
  return {
    list: async () => existingNames.map(name => ({ name })),
  };
}

describe('uniquifyName', () => {
  it('liefert Original-Name wenn keine Kollision', async () => {
    const client = makeMockClient(['anders.jpg']);
    expect(await uniquifyName(client, 'foto.jpg')).toBe('foto.jpg');
  });

  it('hängt _2 an bei einer Kollision', async () => {
    const client = makeMockClient(['foto.jpg']);
    expect(await uniquifyName(client, 'foto.jpg')).toBe('foto_2.jpg');
  });

  it('zählt _3, _4 hoch bei mehreren Kollisionen', async () => {
    const client = makeMockClient(['foto.jpg', 'foto_2.jpg', 'foto_3.jpg']);
    expect(await uniquifyName(client, 'foto.jpg')).toBe('foto_4.jpg');
  });

  it('handhabt Dateien ohne Extension', async () => {
    const client = makeMockClient(['README']);
    expect(await uniquifyName(client, 'README')).toBe('README_2');
  });

  it('handhabt mehrere Punkte im Namen (z.B. archive.tar.gz)', async () => {
    const client = makeMockClient(['archive.tar.gz']);
    // splittet beim letzten Punkt → "archive.tar" + ".gz"
    expect(await uniquifyName(client, 'archive.tar.gz')).toBe('archive.tar_2.gz');
  });

  it('Fallback auf Timestamp bei extrem vielen Kollisionen', async () => {
    const taken = ['foto.jpg', ...Array.from({ length: 98 }, (_, i) => `foto_${i + 2}.jpg`)];
    const client = makeMockClient(taken);
    const result = await uniquifyName(client, 'foto.jpg');
    expect(result).toMatch(/^foto_\d{13,}\.jpg$/);
  });
});

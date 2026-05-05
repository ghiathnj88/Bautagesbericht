import { describe, it, expect, beforeEach } from 'vitest';

// Crypto-Service liest seinen Key aus ENV beim Import.
// Wir setzen einen festen Test-Key, bevor wir den Service importieren.
const TEST_KEY = 'test-key-32-bytes-AAAAAAAAAAAAAAAA';

beforeEach(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY;
});

describe('encrypt / decrypt', () => {
  it('Round-Trip ergibt das Original', async () => {
    const { encrypt, decrypt } = await import('./crypto.service.js');
    const original = 'Mein-Geheimes-Passwort-123!';
    const ciphertext = encrypt(original);
    expect(ciphertext).not.toBe(original);
    expect(decrypt(ciphertext)).toBe(original);
  });

  it('Round-Trip mit leerem String', async () => {
    const { encrypt, decrypt } = await import('./crypto.service.js');
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('Round-Trip mit Unicode/Sonderzeichen', async () => {
    const { encrypt, decrypt } = await import('./crypto.service.js');
    const original = 'Ümläütè ÄÖÜß 你好 🎉 \\\n\t"';
    expect(decrypt(encrypt(original))).toBe(original);
  });

  it('Zwei Verschlüsselungen desselben Klartextes liefern unterschiedliche Cipher (IV)', async () => {
    const { encrypt } = await import('./crypto.service.js');
    const a = encrypt('hallo');
    const b = encrypt('hallo');
    expect(a).not.toBe(b);
  });

  it('decrypt mit kaputtem Cipher wirft', async () => {
    const { decrypt } = await import('./crypto.service.js');
    expect(() => decrypt('not-a-valid-ciphertext')).toThrow();
  });
});

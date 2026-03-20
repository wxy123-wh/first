import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const KEY_FILE_NAME = 'provider-api-key.key';
const ALGO = 'aes-256-gcm';
const PREFIX = 'v1';

export class CredentialVault {
  private readonly key: Buffer;

  constructor(projectPath: string) {
    const lisanDir = join(projectPath, '.lisan');
    mkdirSync(lisanDir, { recursive: true });
    const keyPath = join(lisanDir, KEY_FILE_NAME);
    this.key = this.loadOrCreateKey(keyPath);
  }

  encrypt(plaintext: string): string {
    const value = plaintext.trim();
    if (!value) {
      return '';
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(payload: string | null | undefined): string | undefined {
    if (!payload || !payload.trim()) {
      return undefined;
    }
    const [version, ivB64, tagB64, encryptedB64] = payload.split(':');
    if (version !== PREFIX || !ivB64 || !tagB64 || !encryptedB64) {
      return undefined;
    }

    try {
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(tagB64, 'base64');
      const encrypted = Buffer.from(encryptedB64, 'base64');
      const decipher = createDecipheriv(ALGO, this.key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
      return plaintext.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private loadOrCreateKey(keyPath: string): Buffer {
    if (existsSync(keyPath)) {
      const existing = readFileSync(keyPath, 'utf8').trim();
      if (existing) {
        const decoded = Buffer.from(existing, 'base64');
        if (decoded.length === 32) {
          return decoded;
        }
      }
    }

    const key = randomBytes(32);
    writeFileSync(keyPath, key.toString('base64'), { encoding: 'utf8', mode: 0o600 });
    return key;
  }
}

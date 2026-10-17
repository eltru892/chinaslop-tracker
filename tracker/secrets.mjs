import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function encryptSecrets(secrets, passphrase) {
  if (typeof passphrase !== 'string' || !passphrase) {
    throw new Error('Enter an encryption password');
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(
    JSON.stringify({
      hoyolabCookie: String(secrets.hoyolabCookie || ''),
      skportToken: String(secrets.skportToken || ''),
      ...(secrets.hoyolabUid ? { hoyolabUid: String(secrets.hoyolabUid) } : {}),
    }),
    'utf8',
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  plaintext.fill(0);
  return {
    version: 1,
    kdf: 'scrypt',
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
    hasHoyo: !!secrets.hoyolabCookie,
    hasSkport: !!secrets.skportToken,
  };
}

export function decryptSecrets(envelope, passphrase) {
  if (envelope?.version !== 1 || envelope?.kdf !== 'scrypt' || envelope?.cipher !== 'aes-256-gcm') {
    throw new Error('Unsupported encrypted secrets format');
  }
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16)
    throw new Error('Invalid encrypted secrets file');
  const key = crypto.scryptSync(passphrase, salt, 32, SCRYPT);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
    try {
      const result = JSON.parse(plaintext.toString('utf8'));
      if (typeof result.hoyolabCookie !== 'string' || typeof result.skportToken !== 'string')
        throw new Error('Invalid secrets data');
      if (result.hoyolabUid !== undefined && typeof result.hoyolabUid !== 'string')
        throw new Error('Invalid account ID');
      return result;
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error('Incorrect encryption password or damaged secrets file');
  } finally {
    key.fill(0);
  }
}

export async function writeEncryptedFile(filePath, envelope) {
  const temporary = filePath + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, filePath);
}

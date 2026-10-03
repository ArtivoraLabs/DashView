import { b64Encode, b64Decode, enc } from './util.js';

/* ── Password hashing: PBKDF2-SHA256, Web-Crypto native (no bcrypt/argon2
   native bindings exist in the Workers runtime). Stored as:
     pbkdf2$<iterations>$<saltB64>$<hashB64>
   ── */
const ITERATIONS = 210000;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64Encode(salt)}$${b64Encode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000) return false;
  const salt = b64Decode(parts[2]);
  const expected = b64Decode(parts[3]);
  const bits = new Uint8Array(await deriveBits(password, salt, iterations));
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

async function deriveBits(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, 256,
  );
}

/* ── AES-GCM encryption for the Odoo connection blob stored in D1.
   env.ODOO_ENC_KEY must be a 32-byte key, base64-encoded (see README:
   `openssl rand -base64 32`, set via `wrangler secret put ODOO_ENC_KEY`).
   ── */
async function aesKey(base64Key) {
  const raw = b64Decode(base64Key);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(obj, base64Key) {
  const key = await aesKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64Encode(iv), data: b64Encode(new Uint8Array(cipher)) };
}

export async function decryptJson(encIv, encData, base64Key) {
  const key = await aesKey(base64Key);
  const iv = b64Decode(encIv);
  const cipherBytes = b64Decode(encData);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
  return JSON.parse(new TextDecoder().decode(plain));
}

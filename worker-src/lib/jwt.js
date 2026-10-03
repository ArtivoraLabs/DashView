import { b64urlEncode, b64urlDecode, enc, dec } from './util.js';

const ISS = 'dashview-api';
const AUD = 'dashview-web';
const TTL_SECONDS = 12 * 60 * 60; // 12h, same as the old Express server

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify'],
  );
}

export async function signJwt(payload, secret) {
  const key = await hmacKey(secret);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = Object.assign({}, payload, {
    iss: ISS, aud: AUD, iat: now, exp: now + TTL_SECONDS,
  });
  const headerB64 = b64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  return `${signingInput}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJwt(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(headerB64)));
    payload = JSON.parse(dec.decode(b64urlDecode(payloadB64)));
  } catch { return null; }
  if (!header || header.alg !== 'HS256') return null;

  const key = await hmacKey(secret);
  const signingInput = `${headerB64}.${payloadB64}`;
  const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), enc.encode(signingInput));
  if (!valid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.iss !== ISS || payload.aud !== AUD) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

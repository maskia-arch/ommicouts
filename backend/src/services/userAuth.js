import crypto from 'node:crypto';
import { config } from '../config.js';

export const SESSION_COOKIE_NAME = 'jcimmo_session';

export const PORTAL_KEYS = [
  'kleinanzeigen',
  'immowelt',
  'ohne_makler',
  'ggw',
  'immoscout',
];

export function isValidEmail(email) {
  const s = String(email || '').trim().toLowerCase();
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function hashPassword(password) {
  const plain = String(password || '');
  if (plain.length < 8) {
    throw new Error('Passwort muss mindestens 8 Zeichen lang sein.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  const plain = String(password || '');
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const actualBuf = crypto.scryptSync(plain, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function hmacSign(payloadB64) {
  return crypto
    .createHmac('sha256', config.userSessionSecret)
    .update(payloadB64)
    .digest('base64url');
}

export function signUserToken({ userId, email }, ttlSeconds = config.sessionTtlSeconds) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: String(userId),
    email: normalizeEmail(email),
    iat: nowSec,
    exp: nowSec + Math.max(300, Number(ttlSeconds) || 604800),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmacSign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyUserToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expectedSig = hmacSign(payloadB64);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload?.sub || !payload?.exp || payload.exp <= nowSec) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        map[key] = decodeURIComponent(val);
      } catch {
        map[key] = val;
      }
    }
  }
  return map;
}

export function normalizeLinkedPortals(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const result = {};
  for (const key of PORTAL_KEYS) {
    const item = input[key] && typeof input[key] === 'object' ? input[key] : {};
    result[key] = {
      linked: Boolean(item.linked),
      account_label: String(item.account_label || '').trim().slice(0, 120),
      updated_at: item.updated_at || null,
    };
  }
  return result;
}

export function sanitizeUser(row) {
  if (!row) return null;
  const { password_hash: _ignored, ...rest } = row;
  return {
    ...rest,
    linked_portals: normalizeLinkedPortals(row.linked_portals),
  };
}

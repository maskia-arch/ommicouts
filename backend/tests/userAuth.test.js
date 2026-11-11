import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { config } from '../src/config.js';
import {
  PORTAL_KEYS,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeLinkedPortals,
  parseCookieHeader,
  sanitizeUser,
  signUserToken,
  verifyPassword,
  verifyUserToken,
} from '../src/services/userAuth.js';

test('hashPassword and verifyPassword use random salt and validate correctly', () => {
  const hash1 = hashPassword('SicherPasswort123');
  const hash2 = hashPassword('SicherPasswort123');

  assert.notEqual(hash1, hash2);
  assert.ok(hash1.startsWith('scrypt$'));
  assert.equal(verifyPassword('SicherPasswort123', hash1), true);
  assert.equal(verifyPassword('FalschesPasswort', hash1), false);
  assert.equal(verifyPassword('SicherPasswort123', 'invalid-format'), false);
  assert.throws(() => hashPassword('kurz'), /mindestens 8 Zeichen/i);
});

test('signUserToken and verifyUserToken accept valid tokens and reject tampering or expiry', () => {
  const token = signUserToken({ userId: 'uuid-42', email: 'Test@Example.DE' }, 3600);
  const decoded = verifyUserToken(token);

  assert.ok(decoded);
  assert.equal(decoded.sub, 'uuid-42');
  assert.equal(decoded.email, 'test@example.de');

  const [payloadB64, sig] = token.split('.');
  const tamperedSig = `${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal(verifyUserToken(`${payloadB64}.${tamperedSig}`), null);
  assert.equal(verifyUserToken('malformed'), null);
  assert.equal(verifyUserToken(''), null);

  // Expired token with valid signature must be rejected
  const expiredPayloadB64 = Buffer.from(
    JSON.stringify({
      sub: 'uuid-42',
      email: 'test@example.de',
      iat: 1000,
      exp: Math.floor(Date.now() / 1000) - 60,
    }),
    'utf8'
  ).toString('base64url');
  const validSigOnExpired = crypto
    .createHmac('sha256', config.userSessionSecret)
    .update(expiredPayloadB64)
    .digest('base64url');
  assert.equal(verifyUserToken(`${expiredPayloadB64}.${validSigOnExpired}`), null);
});

test('normalizeLinkedPortals initializes all 5 supported portals safely', () => {
  const normalized = normalizeLinkedPortals({
    kleinanzeigen: { linked: true, account_label: '  max@ge.de  ', updated_at: '2026-01-01T00:00:00Z' },
    unknown_portal: { linked: true },
  });

  assert.deepEqual(Object.keys(normalized), PORTAL_KEYS);
  assert.equal(normalized.kleinanzeigen.linked, true);
  assert.equal(normalized.kleinanzeigen.account_label, 'max@ge.de');
  assert.equal(normalized.kleinanzeigen.updated_at, '2026-01-01T00:00:00Z');
  assert.equal(normalized.immowelt.linked, false);
  assert.equal(normalized.immowelt.account_label, '');
  assert.equal('unknown_portal' in normalized, false);
});

test('sanitizeUser never exposes password_hash', () => {
  const sanitized = sanitizeUser({
    id: 'user-1',
    email: 'max@example.de',
    password_hash: 'scrypt$secret$hash',
    full_name: 'Max Mustermann',
    linked_portals: { ggw: { linked: 1, account_label: 'GGW Konto' } },
  });

  assert.equal(sanitized.id, 'user-1');
  assert.equal(sanitized.email, 'max@example.de');
  assert.equal('password_hash' in sanitized, false);
  assert.equal(sanitized.linked_portals.ggw.linked, true);
  assert.equal(sanitizeUser(null), null);
});

test('email validation and cookie header parsing work properly', () => {
  assert.equal(isValidEmail('user@example.de'), true);
  assert.equal(isValidEmail('invalid-email'), false);
  assert.equal(normalizeEmail('  MAX@Example.DE '), 'max@example.de');

  const cookies = parseCookieHeader('foo=bar; jcimmo_session=abc%2Edef%3D1; theme=dark');
  assert.equal(cookies.foo, 'bar');
  assert.equal(cookies.jcimmo_session, 'abc.def=1');
  assert.equal(cookies.theme, 'dark');
});

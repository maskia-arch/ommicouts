import crypto from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db.js';
import {
  parseCookieHeader,
  sanitizeUser,
  SESSION_COOKIE_NAME,
  verifyUserToken,
} from '../services/userAuth.js';

function safeEquals(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function requireAdminKey(req, res, next) {
  if (!config.adminSecretKey) {
    return res.status(503).json({
      error: 'ADMIN_SECRET_KEY ist auf dem Server nicht konfiguriert.',
    });
  }

  const provided = req.headers['x-admin-key'];
  if (!safeEquals(provided, config.adminSecretKey)) {
    return res.status(401).json({
      error: 'Zugriff verweigert: Ungültiger oder fehlender x-admin-key Header.',
    });
  }

  return next();
}

export function requireWebhookSecret(req, res, next) {
  const expected = config.webhookSecret || config.adminSecretKey;
  if (!expected) {
    return res.status(503).json({
      error: 'WEBHOOK_SECRET / ADMIN_SECRET_KEY ist nicht konfiguriert.',
    });
  }

  const provided =
    req.headers['x-webhook-secret'] ||
    req.headers['x-admin-key'] ||
    req.query?.secret;

  if (!safeEquals(provided, expected)) {
    return res.status(401).json({
      error: 'Webhook-Authentifizierung fehlgeschlagen.',
    });
  }

  return next();
}

function extractUserToken(req) {
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

async function resolveAuthenticatedUser(req) {
  const token = extractUserToken(req);
  if (!token) return { user: null, reason: 'missing' };

  const payload = verifyUserToken(token);
  if (!payload?.sub) return { user: null, reason: 'invalid' };

  const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [payload.sub]);
  if (rows.length === 0) return { user: null, reason: 'not_found' };
  if (rows[0].status !== 'active') return { user: null, reason: 'blocked' };

  return { user: sanitizeUser(rows[0]), reason: null };
}

export async function optionalUserAuth(req, _res, next) {
  try {
    const resolved = await resolveAuthenticatedUser(req);
    req.user = resolved.user;
  } catch {
    req.user = null;
  }
  return next();
}

export async function requireUserAuth(req, res, next) {
  try {
    const resolved = await resolveAuthenticatedUser(req);
    if (!resolved.user) {
      if (resolved.reason === 'blocked') {
        return res.status(403).json({
          error: 'Dein Benutzerkonto wurde gesperrt. Bitte kontaktiere den Support.',
        });
      }
      return res.status(401).json({
        error: 'Anmeldung erforderlich. Bitte zuerst einloggen.',
      });
    }
    req.user = resolved.user;
    return next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

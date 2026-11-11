import crypto from 'node:crypto';
import { config } from '../config.js';

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

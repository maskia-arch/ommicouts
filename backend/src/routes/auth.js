import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { optionalUserAuth, requireUserAuth } from '../middleware/auth.js';
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeLinkedPortals,
  sanitizeUser,
  SESSION_COOKIE_NAME,
  signUserToken,
  verifyPassword,
} from '../services/userAuth.js';

const router = Router();

// Lightweight in-memory rate limit for auth endpoints (25 attempts per 15 min per IP)
const authAttempts = new Map();
function checkAuthRateLimit(req, res) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = authAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    authAttempts.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= 25) {
    res.status(429).json({
      error: 'Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.',
    });
    return false;
  }
  entry.count++;
  return true;
}

function setSessionCookie(req, res, token) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || proto.includes('https');
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: config.sessionTtlSeconds * 1000,
  });
}

function clearSessionCookie(req, res) {
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  const isHttps = req.secure || proto.includes('https');
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
  });
}

// ------------------------------------------------------------------------------
// Auth Endpoints (/api/auth/*)
// ------------------------------------------------------------------------------
router.post('/auth/register', async (req, res) => {
  if (!checkAuthRateLimit(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const fullName = String(req.body?.full_name || '').trim().slice(0, 150);
    const phone = String(req.body?.phone || '').trim().slice(0, 60);
    const preferredCity = String(req.body?.preferred_city || 'Gelsenkirchen').trim().slice(0, 100) || 'Gelsenkirchen';
    const bgSize = Math.min(20, Math.max(1, parseInt(req.body?.bg_size || '1', 10) || 1));
    const benefitType = req.body?.benefit_type === 'sgb12' ? 'sgb12' : 'sgb2';

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Das Passwort muss mindestens 8 Zeichen lang sein.' });
    }
    if (!fullName) {
      return res.status(400).json({ error: 'Bitte deinen Namen eingeben.' });
    }

    const existing = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Diese E-Mail-Adresse ist bereits registriert.' });
    }

    const passwordHash = hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (
         email, password_hash, full_name, phone, preferred_city, bg_size, benefit_type,
         linked_portals, last_login_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
       RETURNING *`,
      [
        email,
        passwordHash,
        fullName,
        phone,
        preferredCity,
        bgSize,
        benefitType,
        JSON.stringify(normalizeLinkedPortals({})),
      ]
    );

    const user = sanitizeUser(rows[0]);
    const token = signUserToken({ userId: user.id, email: user.email });
    setSessionCookie(req, res, token);

    return res.status(201).json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/auth/login', async (req, res) => {
  if (!checkAuthRateLimit(req, res)) return;

  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Bitte E-Mail-Adresse und Passwort eingeben.' });
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: 'E-Mail-Adresse oder Passwort ist falsch.' });
    }

    if (rows[0].status !== 'active') {
      return res.status(403).json({
        error: 'Dieses Benutzerkonto wurde vom Administrator gesperrt.',
      });
    }

    const updatedRes = await pool.query(
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [rows[0].id]
    );
    const user = sanitizeUser(updatedRes.rows[0]);
    const token = signUserToken({ userId: user.id, email: user.email });
    setSessionCookie(req, res, token);

    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  return res.json({ ok: true });
});

router.get('/auth/me', optionalUserAuth, (req, res) => {
  if (!req.user) {
    return res.json({ authenticated: false, user: null });
  }
  return res.json({ authenticated: true, user: req.user });
});

// ------------------------------------------------------------------------------
// Authenticated User Area (/api/me/*)
// ------------------------------------------------------------------------------
router.put('/me/profile', requireUserAuth, async (req, res) => {
  try {
    const {
      full_name,
      phone,
      preferred_city,
      bg_size,
      benefit_type,
      move_in_date,
      personal_note,
      emphasize_direct_transfer,
      address_schufa_directly,
      linked_portals,
    } = req.body || {};

    const nextLinked =
      linked_portals !== undefined
        ? normalizeLinkedPortals(linked_portals)
        : req.user.linked_portals;

    const { rows } = await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           preferred_city = COALESCE($3, preferred_city),
           bg_size = COALESCE($4, bg_size),
           benefit_type = COALESCE($5, benefit_type),
           move_in_date = COALESCE($6, move_in_date),
           personal_note = COALESCE($7, personal_note),
           emphasize_direct_transfer = COALESCE($8, emphasize_direct_transfer),
           address_schufa_directly = COALESCE($9, address_schufa_directly),
           linked_portals = $10::jsonb,
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        full_name !== undefined ? String(full_name).trim().slice(0, 150) : null,
        phone !== undefined ? String(phone).trim().slice(0, 60) : null,
        preferred_city !== undefined ? String(preferred_city).trim().slice(0, 100) || 'Gelsenkirchen' : null,
        bg_size !== undefined ? Math.min(20, Math.max(1, parseInt(bg_size, 10) || 1)) : null,
        benefit_type !== undefined ? (benefit_type === 'sgb12' ? 'sgb12' : 'sgb2') : null,
        move_in_date !== undefined ? String(move_in_date).trim().slice(0, 120) : null,
        personal_note !== undefined ? String(personal_note).trim().slice(0, 1500) : null,
        emphasize_direct_transfer !== undefined ? Boolean(emphasize_direct_transfer) : null,
        address_schufa_directly !== undefined ? Boolean(address_schufa_directly) : null,
        JSON.stringify(nextLinked),
        req.user.id,
      ]
    );

    return res.json({ user: sanitizeUser(rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/me/password', requireUserAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen lang sein.' });
    }

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
    if (rows.length === 0 || !verifyPassword(currentPassword, rows[0].password_hash)) {
      return res.status(401).json({ error: 'Das aktuelle Passwort stimmt nicht.' });
    }

    const newHash = hashPassword(newPassword);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
      newHash,
      req.user.id,
    ]);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/me/applications', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ua.id,
         ua.listing_id,
         ua.portal,
         ua.status AS application_status,
         ua.message_text,
         ua.notes,
         ua.contacted_at,
         ua.created_at,
         ua.updated_at,
         l.title,
         l.url,
         l.city,
         l.district,
         l.zipcode,
         l.cold_rent,
         l.additional_costs,
         l.calculated_bruttokalt,
         l.sqm,
         l.rooms,
         l.is_private_landlord,
         l.wbs_required,
         l.status AS listing_status
       FROM user_applications ua
       JOIN listings l ON l.id = ua.listing_id
       WHERE ua.user_id = $1
       ORDER BY ua.updated_at DESC`,
      [req.user.id]
    );

    return res.json({ applications: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/me/applications', requireUserAuth, async (req, res) => {
  try {
    const listingId = String(req.body?.listing_id || '').trim();
    const status = ['saved', 'contacted', 'viewing', 'accepted', 'rejected'].includes(req.body?.status)
      ? req.body.status
      : 'contacted';
    const messageText = req.body?.message_text ? String(req.body.message_text).slice(0, 6000) : null;
    const notes = req.body?.notes ? String(req.body.notes).slice(0, 2000) : null;

    if (!listingId) {
      return res.status(400).json({ error: 'listing_id ist erforderlich.' });
    }

    const listingRes = await pool.query(`SELECT id, portal FROM listings WHERE id = $1`, [listingId]);
    if (listingRes.rows.length === 0) {
      return res.status(404).json({ error: 'Wohnungsangebot nicht gefunden.' });
    }

    const contactedAt = status === 'saved' ? null : new Date();
    const { rows } = await pool.query(
      `INSERT INTO user_applications (user_id, listing_id, portal, status, message_text, notes, contacted_at)
       VALUES ($1, $2, $3, $4::varchar, $5, $6, $7)
       ON CONFLICT (user_id, listing_id) DO UPDATE SET
         status = EXCLUDED.status,
         message_text = COALESCE(EXCLUDED.message_text, user_applications.message_text),
         notes = COALESCE(EXCLUDED.notes, user_applications.notes),
         contacted_at = COALESCE(user_applications.contacted_at, EXCLUDED.contacted_at),
         updated_at = NOW()
       RETURNING id, user_id, listing_id, portal, status, status AS application_status, message_text, notes, contacted_at, created_at, updated_at`,
      [req.user.id, listingId, listingRes.rows[0].portal, status, messageText, notes, contactedAt]
    );

    return res.status(201).json({ application: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.patch('/me/applications/:id', requireUserAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const validStatuses = ['saved', 'contacted', 'viewing', 'accepted', 'rejected'];
    const nextStatus =
      req.body?.status !== undefined && validStatuses.includes(req.body.status)
        ? req.body.status
        : null;
    const nextNotes = req.body?.notes !== undefined ? String(req.body.notes).slice(0, 2000) : null;
    const markContacted = ['contacted', 'viewing', 'accepted', 'rejected'].includes(nextStatus);

    const { rows } = await pool.query(
      `UPDATE user_applications
       SET status = COALESCE($1::varchar, status),
           notes = COALESCE($2, notes),
           contacted_at = CASE WHEN $3::boolean AND contacted_at IS NULL THEN NOW() ELSE contacted_at END,
           updated_at = NOW()
       WHERE id = $4 AND user_id = $5
       RETURNING id, user_id, listing_id, portal, status, status AS application_status, message_text, notes, contacted_at, created_at, updated_at`,
      [nextStatus, nextNotes, markContacted, id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    }
    return res.json({ application: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/me/applications/:id', requireUserAuth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM user_applications WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

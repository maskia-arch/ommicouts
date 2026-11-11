import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { optionalUserAuth, requireActiveOrganization, requireUserAuth } from '../middleware/auth.js';
import {
  hashOrgKey,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  normalizeLinkedPortals,
  sanitizeUser,
  SESSION_COOKIE_NAME,
  signUserToken,
  USER_WITH_ORG_SELECT,
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
      `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [rows[0].id]
    );
    void updatedRes;
    const fullRes = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1 LIMIT 1`, [
      rows[0].id,
    ]);
    const user = sanitizeUser(fullRes.rows[0]);
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

    await pool.query(
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
       WHERE id = $11`,
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

    const refreshed = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1 LIMIT 1`, [
      req.user.id,
    ]);
    return res.json({ user: sanitizeUser(refreshed.rows[0]) });
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
         l.contact_name,
         l.contact_phone,
         l.contact_email,
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

// ------------------------------------------------------------------------------
// User Hidden Listings (/api/me/hidden-listings)
// ------------------------------------------------------------------------------
router.get('/me/hidden-listings', requireUserAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT uhl.id, uhl.listing_id, uhl.created_at,
              l.title, l.url, l.portal, l.city, l.district, l.zipcode,
              l.calculated_bruttokalt, l.sqm, l.rooms, l.status AS listing_status
       FROM user_hidden_listings uhl
       JOIN listings l ON l.id = uhl.listing_id
       WHERE uhl.user_id = $1
       ORDER BY uhl.created_at DESC`,
      [req.user.id]
    );
    return res.json({ hiddenListings: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/me/hidden-listings', requireUserAuth, async (req, res) => {
  try {
    const listingId = String(req.body?.listing_id || '').trim();
    if (!listingId) {
      return res.status(400).json({ error: 'listing_id ist erforderlich.' });
    }
    await pool.query(
      `INSERT INTO user_hidden_listings (user_id, listing_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, listing_id) DO NOTHING`,
      [req.user.id, listingId]
    );
    return res.status(201).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/me/hidden-listings/:listingId', requireUserAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM user_hidden_listings WHERE user_id = $1 AND listing_id = $2`,
      [req.user.id, req.params.listingId]
    );
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Listing Reports (/api/me/reports)
// ------------------------------------------------------------------------------
export const REPORT_REASONS = {
  no_jobcenter: 'Kein Jobcenter gewünscht / ausdrücklich abgelehnt',
  wrong_description: 'Objektbeschreibung nicht zutreffend / fehlerhafte Beschreibung',
  already_rented: 'Wohnung bereits vergeben / Anzeige nicht mehr aktuell',
  wrong_price: 'Miete / Nebenkosten stimmen nicht (zu teuer)',
  spam_fraud: 'Verdacht auf Fake-Anzeige / Betrug / Spam',
  other: 'Sonstiger Grund',
};

router.post('/me/reports', requireUserAuth, async (req, res) => {
  try {
    const listingId = String(req.body?.listing_id || '').trim();
    const reasonCode = String(req.body?.reason_code || '').trim();
    const details = req.body?.details ? String(req.body.details).trim().slice(0, 1500) : null;
    const alsoHide = Boolean(req.body?.also_hide);

    if (!listingId) {
      return res.status(400).json({ error: 'listing_id ist erforderlich.' });
    }
    if (!REPORT_REASONS[reasonCode]) {
      return res.status(400).json({ error: 'Bitte einen gültigen Meldegrund auswählen.' });
    }
    if (reasonCode === 'other' && (!details || details.length < 5)) {
      return res.status(400).json({ error: 'Bitte bei „Sonstiger Grund“ kurz den Grund beschreiben.' });
    }

    const listRes = await pool.query(
      `SELECT id, external_id, portal, city, title, url FROM listings WHERE id = $1 LIMIT 1`,
      [listingId]
    );
    if (listRes.rows.length === 0) {
      return res.status(404).json({ error: 'Wohnungsangebot nicht gefunden.' });
    }
    const l = listRes.rows[0];
    const reasonLabel = REPORT_REASONS[reasonCode];

    const { rows } = await pool.query(
      `INSERT INTO listing_reports (
         listing_id, listing_external_id, listing_portal, listing_city, listing_title, listing_url,
         user_id, reason_code, reason_label, details, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open')
       ON CONFLICT (listing_id, user_id) DO UPDATE SET
         reason_code = EXCLUDED.reason_code,
         reason_label = EXCLUDED.reason_label,
         details = EXCLUDED.details,
         status = 'open',
         reviewed_at = NULL,
         updated_at = NOW()
       RETURNING *`,
      [l.id, l.external_id, l.portal, l.city, l.title, l.url, req.user.id, reasonCode, reasonLabel, details]
    );

    if (alsoHide) {
      await pool.query(
        `INSERT INTO user_hidden_listings (user_id, listing_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, listing_id) DO NOTHING`,
        [req.user.id, l.id]
      );
    }

    return res.status(201).json({ report: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------------------
// Organization Activation & Profile Settings (/api/me/organization/*)
// ------------------------------------------------------------------------------
router.post('/me/organization/activate', requireUserAuth, async (req, res) => {
  if (!checkAuthRateLimit(req, res)) return;

  const rawKey = String(req.body?.key || '').trim();
  const keyHash = hashOrgKey(rawKey);
  if (!keyHash || rawKey.length < 10) {
    return res.status(400).json({ error: 'Bitte einen gültigen Organisations-Key eingeben.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: keyRows } = await client.query(
      `SELECT * FROM organization_keys WHERE key_hash = $1 FOR UPDATE`,
      [keyHash]
    );

    if (keyRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Dieser Organisations-Key wurde nicht gefunden.' });
    }

    const keyRow = keyRows[0];
    if (keyRow.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Dieser Organisations-Key wurde widerrufen.' });
    }

    if (keyRow.redeemed_by_user_id && keyRow.redeemed_by_user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Dieser Organisations-Key wurde bereits einem anderen Konto zugewiesen.',
      });
    }

    let computedExpiresAt = null;
    if (!keyRow.is_unlimited) {
      if (keyRow.expires_at) {
        if (new Date(keyRow.expires_at).getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Dieser Organisations-Key ist bereits abgelaufen.' });
        }
        computedExpiresAt = keyRow.expires_at;
      } else {
        const days = Math.max(1, Number(keyRow.duration_days) || 30);
        computedExpiresAt = new Date(Date.now() + days * 86400 * 1000);
      }
    }

    await client.query(
      `UPDATE organization_keys
       SET redeemed_by_user_id = $1,
           redeemed_at = COALESCE(redeemed_at, NOW()),
           expires_at = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [req.user.id, computedExpiresAt, keyRow.id]
    );

    const { rows: curUserRows } = await client.query(`SELECT * FROM users WHERE id = $1`, [
      req.user.id,
    ]);
    const curUser = curUserRows[0];

    const nextOrgName = keyRow.preset_org_name || curUser.org_name || curUser.full_name || '';
    const nextOrgSubtitle = keyRow.preset_org_subtitle || curUser.org_subtitle || '';
    const nextOrgLogoUrl = keyRow.preset_org_logo_url || curUser.org_logo_url || '';
    const nextOrgContact = keyRow.preset_org_contact || curUser.org_contact || curUser.phone || '';
    const nextPreferredCity = keyRow.preset_city || curUser.preferred_city || 'Gelsenkirchen';

    await client.query(
      `UPDATE users
       SET account_type = 'organization',
           org_key_id = $1,
           org_name = $2,
           org_subtitle = $3,
           org_logo_url = $4,
           org_contact = $5,
           preferred_city = $6,
           org_license_unlimited = $7,
           org_license_expires_at = $8,
           updated_at = NOW()
       WHERE id = $9`,
      [
        keyRow.id,
        nextOrgName,
        nextOrgSubtitle,
        nextOrgLogoUrl,
        nextOrgContact,
        nextPreferredCity,
        Boolean(keyRow.is_unlimited),
        computedExpiresAt,
        req.user.id,
      ]
    );

    await client.query('COMMIT');

    const refreshed = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1 LIMIT 1`, [
      req.user.id,
    ]);
    return res.json({ user: sanitizeUser(refreshed.rows[0]) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/me/organization/settings', requireUserAuth, requireActiveOrganization, async (req, res) => {
  try {
    const orgName = String(req.body?.org_name ?? req.user.org_name ?? '').trim().slice(0, 180);
    const orgSubtitle = String(req.body?.org_subtitle ?? req.user.org_subtitle ?? '').trim().slice(0, 220);
    const orgContact = String(req.body?.org_contact ?? req.user.org_contact ?? '').trim().slice(0, 500);
    const rawLogo = req.body?.org_logo_url !== undefined ? String(req.body.org_logo_url || '').trim() : req.user.org_logo_url;

    if (rawLogo) {
      const isHttpsUrl = /^https?:\/\/.{4,1000}$/i.test(rawLogo);
      const isSafeDataUri = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(rawLogo);
      if (!isHttpsUrl && !isSafeDataUri) {
        return res.status(400).json({
          error: 'Logo muss entweder eine http(s)-URL oder ein hochgeladenes PNG/JPG/WebP-Bild sein.',
        });
      }
      if (rawLogo.length > 550000) {
        return res.status(400).json({ error: 'Logo-Datei ist zu groß (max. ca. 400 KB).' });
      }
    }

    await pool.query(
      `UPDATE users
       SET org_name = $1,
           org_subtitle = $2,
           org_logo_url = $3,
           org_contact = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [orgName, orgSubtitle, rawLogo || '', orgContact, req.user.id]
    );

    const refreshed = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1 LIMIT 1`, [
      req.user.id,
    ]);
    return res.json({ user: sanitizeUser(refreshed.rows[0]) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;

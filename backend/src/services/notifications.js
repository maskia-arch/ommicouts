import { pool } from '../db.js';

function formatEurPlain(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '–';
  return `${n.toFixed(2).replace('.', ',')} €`;
}

/**
 * Computes human-readable change events between `before` and `after` states of a listing.
 */
export function buildListingChangeEvents(before, after) {
  if (!before || !after) return [];
  const events = [];
  const titleText = after.title || before.title || 'Gemerkte Wohnung';

  if (before.status !== after.status) {
    if (after.status === 'offline') {
      events.push({
        event_type: 'listing_offline',
        title: 'Gemerkte Wohnung ist nicht mehr verfügbar',
        message: `Die Wohnung „${titleText}“ ist auf dem Ursprungsportal nicht mehr abrufbar bzw. wurde bereits vergeben (Status: offline).`,
        metadata: { old_status: before.status, new_status: after.status },
      });
    } else if (after.status === 'manual_hidden') {
      events.push({
        event_type: 'listing_hidden',
        title: 'Gemerkte Wohnung deaktiviert',
        message: `Die Wohnung „${titleText}“ wurde nach einer Qualitäts- oder Meldungsprüfung durch die Administration deaktiviert.`,
        metadata: { old_status: before.status, new_status: after.status },
      });
    } else if (before.status !== 'active' && after.status === 'active') {
      events.push({
        event_type: 'listing_updated',
        title: 'Gemerkte Wohnung wieder aktiv',
        message: `Die Wohnung „${titleText}“ ist wieder als aktives Angebot verfügbar.`,
        metadata: { old_status: before.status, new_status: after.status },
      });
    }
  }

  const oldBrutto = Number(before.calculated_bruttokalt);
  const newBrutto = Number(after.calculated_bruttokalt);
  const oldCold = Number(before.cold_rent);
  const newCold = Number(after.cold_rent);
  const oldNk = Number(before.additional_costs || 0);
  const newNk = Number(after.additional_costs || 0);

  if (
    Number.isFinite(oldBrutto) &&
    Number.isFinite(newBrutto) &&
    (Math.abs(oldBrutto - newBrutto) >= 0.5 ||
      Math.abs(oldCold - newCold) >= 0.5 ||
      Math.abs(oldNk - newNk) >= 0.5)
  ) {
    const diff = newBrutto - oldBrutto;
    const trend = diff > 0 ? 'gestiegen' : diff < 0 ? 'gesunken' : 'angepasst';
    events.push({
      event_type: 'price_changed',
      title: `Mietänderung bei gemerkter Wohnung (${trend})`,
      message: `Bei „${titleText}“ hat sich die Miete geändert: Bruttokaltmiete von ${formatEurPlain(oldBrutto)} auf ${formatEurPlain(newBrutto)} (Kaltmiete ${formatEurPlain(newCold)} + NK ${formatEurPlain(newNk)}).`,
      metadata: {
        old_bruttokalt: oldBrutto,
        new_bruttokalt: newBrutto,
        old_cold_rent: oldCold,
        new_cold_rent: newCold,
        old_additional_costs: oldNk,
        new_additional_costs: newNk,
      },
    });
  }

  const changedDetails = [];
  if (
    before.sqm !== null &&
    after.sqm !== null &&
    Math.abs(Number(before.sqm) - Number(after.sqm)) >= 0.5
  ) {
    changedDetails.push(`Wohnfläche: ${before.sqm} m² -> ${after.sqm} m²`);
  }
  if (
    before.rooms !== null &&
    after.rooms !== null &&
    Math.abs(Number(before.rooms) - Number(after.rooms)) >= 0.25
  ) {
    changedDetails.push(`Zimmer: ${before.rooms} -> ${after.rooms}`);
  }
  if (Boolean(before.wbs_required) !== Boolean(after.wbs_required)) {
    changedDetails.push(`WBS: ${after.wbs_required ? 'jetzt erforderlich' : 'nicht mehr erforderlich'}`);
  }
  if (
    before.title &&
    after.title &&
    before.title.trim() !== after.title.trim() &&
    events.length === 0
  ) {
    changedDetails.push(`Neuer Titel: „${after.title}“`);
  }

  if (changedDetails.length > 0) {
    events.push({
      event_type: 'listing_updated',
      title: 'Angaben einer gemerkten Wohnung aktualisiert',
      message: `Bei „${titleText}“ wurden Objektdaten aktualisiert: ${changedDetails.join(' · ')}.`,
      metadata: { changes: changedDetails },
    });
  }

  return events;
}

async function insertNotificationForWatchers(client, listing, event) {
  const { rows: watchers } = await client.query(
    `SELECT DISTINCT user_id FROM user_applications WHERE listing_id = $1`,
    [listing.id]
  );
  if (watchers.length === 0) return 0;

  let inserted = 0;
  for (const w of watchers) {
    const res = await client.query(
      `INSERT INTO user_notifications (
         user_id, listing_id, event_type, title, message,
         listing_title_snapshot, listing_url_snapshot, metadata
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM user_notifications
         WHERE user_id = $1
           AND listing_id = $2
           AND event_type = $3
           AND message = $5
           AND created_at > NOW() - INTERVAL '60 minutes'
       )`,
      [
        w.user_id,
        listing.id,
        event.event_type,
        event.title,
        event.message,
        listing.title || null,
        listing.url || null,
        JSON.stringify(event.metadata || {}),
      ]
    );
    inserted += res.rowCount || 0;
  }
  return inserted;
}

export async function notifyWatchersListingChanged({ before, after, client = pool }) {
  if (!before || !after || !after.id) return 0;
  const events = buildListingChangeEvents(before, after);
  if (events.length === 0) return 0;

  let total = 0;
  for (const evt of events) {
    total += await insertNotificationForWatchers(client, after, evt);
  }
  return total;
}

export async function notifyWatchersListingDeleted({ listing, reason = 'admin_deleted', client = pool }) {
  if (!listing || !listing.id) return 0;
  const titleText = listing.title || 'Gemerkte Wohnung';
  const msg =
    reason === 'admin_report_deleted'
      ? `Die Wohnung „${titleText}“ wurde nach einer Meldungsprüfung endgültig aus dem Portalbestand gelöscht.`
      : `Die Wohnung „${titleText}“ wurde aus dem Bestand gelöscht und steht nicht mehr zur Verfügung.`;

  return insertNotificationForWatchers(client, listing, {
    event_type: 'listing_deleted',
    title: 'Gemerkte Wohnung wurde gelöscht',
    message: msg,
    metadata: { reason, external_id: listing.external_id || null },
  });
}

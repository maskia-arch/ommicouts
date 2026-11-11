'use client';

import React, { useState } from 'react';
import { X, Flag, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { ListingItem, ReportReasonCode } from '@/types/immo';

interface ReportListingModalProps {
  listing: ListingItem | null;
  onClose: () => void;
  onSubmitted: (listingId: string, alsoHidden: boolean) => void;
}

const REPORT_REASONS: Array<{
  code: ReportReasonCode;
  label: string;
  description: string;
}> = [
  {
    code: 'no_jobcenter',
    label: 'Kein Jobcenter gewünscht',
    description: 'Vermieter schließt Jobcenter / SGB II / SGB XII oder Kostenübernahme ausdrücklich aus.',
  },
  {
    code: 'wrong_description',
    label: 'Objektbeschreibung nicht zutreffend / fehlerhaft',
    description: 'Wohnungsdaten, Zimmer, m², Stadtteil oder Ausstattung stimmen nicht mit dem Inserat überein.',
  },
  {
    code: 'already_rented',
    label: 'Bereits vergeben / Anzeige offline',
    description: 'Die Wohnung ist nicht mehr verfügbar oder das Inserat wurde entfernt.',
  },
  {
    code: 'wrong_price',
    label: 'Miete / Nebenkosten falsch erfasst',
    description: 'Kaltmiete, Nebenkosten oder Bruttokaltmiete weichen erheblich vom Originalinserat ab.',
  },
  {
    code: 'spam_fraud',
    label: 'Fake / Betrug / Gesuch / Gewerbe',
    description: 'Kein echtes Wohnungsangebot (z. B. Tausch, WG-Zimmer, Garage, Spam oder Betrugsverdacht).',
  },
  {
    code: 'other',
    label: 'Sonstiger Meldegrund',
    description: 'Bitte beschreibe den genauen Grund im Textfeld unten (mind. 5 Zeichen).',
  },
];

export default function ReportListingModal({
  listing,
  onClose,
  onSubmitted,
}: ReportListingModalProps) {
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>('no_jobcenter');
  const [details, setDetails] = useState('');
  const [alsoHide, setAlsoHide] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!listing) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!listing) return;

    if (reasonCode === 'other' && details.trim().length < 5) {
      setError('Bitte gib bei „Sonstiger Meldegrund“ mindestens 5 Zeichen Erklärung an.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/me/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listing.id,
          reason_code: reasonCode,
          details: details.trim(),
          also_hide: alsoHide,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Meldung konnte nicht gespeichert werden.');
      }
      setDone(true);
      onSubmitted(listing.id, alsoHide);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Melden.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
              <Flag className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Anzeige melden</h3>
              <p className="line-clamp-1 text-xs text-slate-400">{listing.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {done ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
              <span>
                Vielen Dank! Deine Meldung wurde zur Prüfung an die Administration übermittelt.
              </span>
            </div>
          ) : (
            <>
              <div>
                <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Genauen Meldegrund auswählen
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {REPORT_REASONS.map((reason) => {
                    const selected = reasonCode === reason.code;
                    return (
                      <label
                        key={reason.code}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                          selected
                            ? 'border-rose-500/60 bg-rose-500/10'
                            : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                        }`}
                      >
                        <input
                          type="radio"
                          name="report_reason"
                          value={reason.code}
                          checked={selected}
                          onChange={() => setReasonCode(reason.code)}
                          className="mt-1 h-4 w-4 accent-rose-500"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">{reason.label}</div>
                          <div className="text-xs text-slate-400">{reason.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  Ergänzende Hinweise {reasonCode === 'other' ? '(erforderlich)' : '(optional)'}
                </label>
                <textarea
                  rows={3}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="z. B. Im Beschreibungstext steht ausdrücklich 'Keine Kostenübernahme durch Jobcenter' oder Kaltmiete beträgt 620 €..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-800 bg-slate-950/50 px-3.5 py-2.5 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={alsoHide}
                  onChange={(e) => setAlsoHide(e.target.checked)}
                  className="h-4 w-4 rounded accent-emerald-500"
                />
                <span>Diese Anzeige zusätzlich aus meiner eigenen Übersicht ausblenden</span>
              </label>

              <div className="flex items-center justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50"
                >
                  <Flag className="h-3.5 w-3.5" />
                  {submitting ? 'Wird gemeldet...' : 'Meldung absenden'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

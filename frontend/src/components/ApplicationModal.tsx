'use client';

import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  ApplicationStatus,
  KduRule,
  ListingItem,
  PortalKey,
  UserApplication,
  UserProfile,
} from '@/types/immo';

interface ApplicationModalProps {
  listing: ListingItem;
  rule: KduRule;
  bgSize: number;
  benefitType: 'sgb2' | 'sgb12';
  user?: UserProfile | null;
  existingApplication?: UserApplication | null;
  onTracked?: () => void;
  onOpenUserArea?: () => void;
  onClose: () => void;
}

function formatEur(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '–';
  return `${val.toFixed(2).replace('.', ',')} €`;
}

function resolvePortalMeta(listing: ListingItem): {
  key: PortalKey;
  label: string;
  loginUrl: string;
} {
  const url = String(listing.url || '').toLowerCase();
  if (listing.portal === 'kleinanzeigen' || url.includes('kleinanzeigen.de')) {
    return {
      key: 'kleinanzeigen',
      label: 'Kleinanzeigen',
      loginUrl: 'https://www.kleinanzeigen.de/m-einloggen.html',
    };
  }
  if (listing.portal === 'immowelt' || url.includes('immowelt.de')) {
    return {
      key: 'immowelt',
      label: 'Immowelt',
      loginUrl: 'https://www.immowelt.de/',
    };
  }
  if (url.includes('ohne-makler.net')) {
    return {
      key: 'ohne_makler',
      label: 'Ohne-Makler.net',
      loginUrl: 'https://www.ohne-makler.net/accounts/login/',
    };
  }
  if (url.includes('ggw-gelsenkirchen.de')) {
    return {
      key: 'ggw',
      label: 'GGW Gelsenkirchen',
      loginUrl: 'https://www.ggw-gelsenkirchen.de/mietangebote/',
    };
  }
  return {
    key: 'immoscout',
    label: 'ImmoScout24',
    loginUrl: 'https://www.immobilienscout24.de/',
  };
}

export function ApplicationModal({
  listing,
  rule,
  bgSize,
  benefitType,
  user,
  existingApplication,
  onTracked,
  onOpenUserArea,
  onClose,
}: ApplicationModalProps) {
  const [applicantName, setApplicantName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [moveInDate, setMoveInDate] = useState(
    user?.move_in_date || 'ab sofort / nach Absprache'
  );
  const [personalNote, setPersonalNote] = useState(
    user?.personal_note ||
      (bgSize === 1
        ? 'ruhige, zuverlässige Einzelperson, Nichtraucher, keine Haustiere'
        : `ruhiger ${bgSize}-Personen-Haushalt, zuverlässig und ordentlich`)
  );
  const [emphasizeDirectTransfer, setEmphasizeDirectTransfer] = useState(
    user?.emphasize_direct_transfer ?? true
  );
  const [addressSchufaDirectly, setAddressSchufaDirectly] = useState(
    user?.address_schufa_directly ?? true
  );
  const [copied, setCopied] = useState(false);
  const [savingStatus, setSavingStatus] = useState<ApplicationStatus | null>(null);
  const [trackNotice, setTrackNotice] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const portalMeta = useMemo(() => resolvePortalMeta(listing), [listing]);
  const linkedEntry = user?.linked_portals?.[portalMeta.key];

  const authorityName =
    benefitType === 'sgb12'
      ? `Sozialamt ${listing.city} (SGB XII)`
      : `Jobcenter ${listing.city} (SGB II)`;

  const legalRef = benefitType === 'sgb12' ? '§ 35 Abs. 1 SGB XII' : '§ 22 Abs. 7 SGB II';

  const generatedText = useMemo(() => {
    const nameLine = applicantName.trim() || '[Ihr Vor- und Nachname]';
    const phoneLine = phone.trim() ? `\nTelefon: ${phone.trim()}` : '';
    const locationPart = listing.district
      ? ` in ${listing.city}-${listing.district}`
      : ` in ${listing.city}`;
    const sizePart = listing.sqm ? ` (${listing.sqm} m²` + (listing.rooms ? `, ${listing.rooms} Zimmer)` : ')') : '';

    const kduComparison =
      listing.compliance_status === 'tolerance'
        ? `Die Bruttokaltmiete von ${formatEur(listing.calculated_bruttokalt)} liegt nahezu exakt im offiziellen Richtwert der Stadt ${listing.city} (${formatEur(rule.max_bruttokalt_eur)} für ${bgSize} ${bgSize === 1 ? 'Person' : 'Personen'}); ein eventueller geringer Restbetrag von ${formatEur(listing.eigenanteil_eur)} wird zuverlässig selbst getragen.`
        : `Die Bruttokaltmiete von ${formatEur(listing.calculated_bruttokalt)} liegt zu 100 % innerhalb der aktuellen Angemessenheitsgrenze der Stadt ${listing.city} (Richtwert für ${bgSize} ${bgSize === 1 ? 'Person' : 'Personen'}: bis ${formatEur(rule.max_bruttokalt_eur)} Bruttokaltmiete). Damit ist die kurzfristige schriftliche Kostenübernahme (Zusicherung) durch das ${authorityName} vollständig gesichert.`;

    const directTransferBlock = emphasizeDirectTransfer
      ? `\n\nFür Sie als Vermieter bietet dies maximale Planungssicherheit:\nAuf Ihren Wunsch veranlasse ich direkt beim ${authorityName} eine verbindliche Direktabtretung (${legalRef}). Damit wird die monatliche Miete zu 100 % pünktlich, automatisiert und ausfallsicher direkt vom Amt auf Ihr Vermieterkonto überwiesen – jeden Monat zuverlässig zum Monatsanfang.`
      : '';

    const schufaBlock = addressSchufaDirectly
      ? `\n\nOffenheit vorab: In meiner Schufa besteht aus der Vergangenheit leider noch ein älterer Eintrag. Gerade deshalb ist mir die Direktzahlung direkt durch das ${authorityName} wichtig – für Sie als Vermieter besteht dadurch faktisch kein Mietausfallrisiko.`
      : '';

    const greeting = listing.is_private_landlord
      ? 'Sehr geehrte(r) Vermieter(in),'
      : 'Sehr geehrte Damen und Herren,';

    return `${greeting}

mit großem Interesse habe ich Ihr Wohnungsangebot „${listing.title}“${locationPart}${sizePart} gesehen und möchte mich Ihnen kurz als zuverlässige(r) Mietinteressent(in) vorstellen.

Zu meiner Person / unserem Haushalt: ${personalNote}. Ein Einzug wäre ${moveInDate} möglich.

Wichtiger Vorteil für eine schnelle und unkomplizierte Abwicklung:
${kduComparison}${directTransferBlock}${schufaBlock}

Alle erforderlichen Unterlagen (Mietbescheinigung zur Vorlage beim Amt, Ausweis sowie auf Wunsch die Abtretungserklärung) bringe ich gerne direkt zu einem Besichtigungstermin mit.

Über eine kurze Rückmeldung oder einen Besichtigungstermin freue ich mich sehr.

Mit freundlichen Grüßen
${nameLine}${phoneLine}`;
  }, [
    applicantName,
    phone,
    moveInDate,
    personalNote,
    emphasizeDirectTransfer,
    addressSchufaDirectly,
    listing,
    rule,
    bgSize,
    authorityName,
    legalRef,
  ]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const trackApplication = async (status: ApplicationStatus) => {
    if (!user) return;
    setSavingStatus(status);
    setTrackError(null);
    setTrackNotice(null);
    try {
      const res = await fetch('/api/me/applications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          listing_id: listing.id,
          status,
          message_text: generatedText,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      const statusNames: Record<ApplicationStatus, string> = {
        saved: 'Vorgemerkt',
        contacted: 'Kontaktiert',
        viewing: 'Besichtigung',
        accepted: 'Zusage',
        rejected: 'Absage',
      };
      setTrackNotice(`In „Mein Bereich“ als „${statusNames[status]}“ gespeichert.`);
      onTracked?.();
    } catch (err) {
      setTrackError(
        err instanceof Error ? err.message : 'Speichern in „Mein Bereich“ fehlgeschlagen.'
      );
    } finally {
      setSavingStatus(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schufa-killer-title"
    >
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/95 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
              <ShieldCheck className="h-4 w-4" />
              Schufa-Killer Anschreiben-Generator
            </div>
            <h2 id="schufa-killer-title" className="mt-1 text-lg font-bold text-white">
              Bewerbungstext für Vermieter
            </h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{listing.title}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Modal schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Portal-Verknüpfung & Tracker Status */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-200">
                  <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                  Portal-Konto ({portalMeta.label}):
                </span>
                {linkedEntry?.linked ? (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    Verknüpft{linkedEntry.account_label ? ` (${linkedEntry.account_label})` : ''}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                    Noch nicht als bereit markiert
                  </span>
                )}
                {existingApplication && (
                  <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                    Bereits in „Mein Bereich“ ({existingApplication.application_status})
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Für die echte Kontaktaufnahme auf {portalMeta.label} öffnet der Button unten das
                Original-Inserat mit deinem eingeloggten {portalMeta.label}-Konto.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <a
                href={portalMeta.loginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-slate-800"
              >
                {portalMeta.label} Login
                <ExternalLink className="h-3 w-3" />
              </a>
              {onOpenUserArea && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenUserArea();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                >
                  Konten verwalten
                </button>
              )}
            </div>
          </div>

          {trackNotice && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-200">
              {trackNotice}
            </div>
          )}
          {trackError && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-200">
              {trackError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Dein Name (optional)
              </label>
              <input
                type="text"
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                placeholder="z. B. Max Mustermann"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Telefonnummer (optional)
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="z. B. 0176 12345678"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Wunsch-Einzugstermin
              </label>
              <input
                type="text"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Kurzbeschreibung Haushalt
              </label>
              <input
                type="text"
                value={personalNote}
                onChange={(e) => setPersonalNote(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:gap-5">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={emphasizeDirectTransfer}
                onChange={(e) => setEmphasizeDirectTransfer(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              Direktabtretung (100 % pünktlich) hervorheben
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={addressSchufaDirectly}
                onChange={(e) => setAddressSchufaDirectly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
              />
              Schufa ehrlich &amp; beruhigend ansprechen
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <FileText className="h-3.5 w-3.5" />
                Kopierfertige Nachricht
              </span>
              <span className="text-[11px] text-slate-400">
                Direkt für Kleinanzeigen / Immowelt / E-Mail
              </span>
            </div>
            <textarea
              readOnly
              rows={13}
              value={generatedText}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3.5 text-sm leading-relaxed text-slate-100 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse items-stretch justify-between gap-2 border-t border-slate-800 bg-slate-900/95 px-5 py-3.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
          >
            Schließen
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => trackApplication('saved')}
                  disabled={savingStatus !== null}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2.5 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50"
                >
                  <BookmarkPlus className="h-4 w-4" />
                  {savingStatus === 'saved' ? 'Speichere...' : 'Merken'}
                </button>
                <select
                  aria-label="Bearbeitungsstand setzen"
                  value={existingApplication?.application_status || ''}
                  disabled={savingStatus !== null}
                  onChange={(e) => {
                    if (e.target.value) {
                      trackApplication(e.target.value as ApplicationStatus);
                    }
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-xs font-semibold text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="" disabled>
                    Stand markieren...
                  </option>
                  <option value="saved">Vorgemerkt</option>
                  <option value="contacted">Kontaktiert</option>
                  <option value="viewing">Besichtigung</option>
                  <option value="accepted">Zusage</option>
                  <option value="rejected">Absage</option>
                </select>
              </>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-400" />
                  Kopiert!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Text kopieren
                </>
              )}
            </button>
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400"
            >
              Zur Originalanzeige
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

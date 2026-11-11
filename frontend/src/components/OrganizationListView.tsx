'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Download,
  ExternalLink,
  FileText,
  Mail,
  Phone,
  Printer,
  RefreshCw,
  AlertTriangle,
  KeyRound,
  Settings,
  CheckSquare,
  Search,
} from 'lucide-react';
import type { HousingListResponse, UserProfile } from '@/types/immo';

interface OrganizationListViewProps {
  user: UserProfile;
  cities: string[];
  onGoToOrgActivation: () => void;
}

export default function OrganizationListView({
  user,
  cities,
  onGoToOrgActivation,
}: OrganizationListViewProps) {
  const defaultCity = user.preferred_city || cities[0] || 'Gelsenkirchen';
  const [city, setCity] = useState(defaultCity);
  const [bgSize, setBgSize] = useState<number>(0); // 0 = Alle Größen
  const [benefitType, setBenefitType] = useState<'sgb2' | 'sgb12'>(user.benefit_type || 'sgb2');
  const [privateOnly, setPrivateOnly] = useState(false);
  const [includeTolerance, setIncludeTolerance] = useState(false);
  const [district, setDistrict] = useState('all');
  const [wbs, setWbs] = useState<'all' | 'without' | 'only'>('all');
  const [requireDirectContact, setRequireDirectContact] = useState(true);
  const [sort, setSort] = useState<'newest' | 'cheapest' | 'largest'>('cheapest');
  const [search, setSearch] = useState('');

  const [data, setData] = useState<HousingListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const isOrgActive = user.org_status === 'active';

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      city,
      bg_size: String(bgSize),
      benefit_type: benefitType,
      private_only: String(privateOnly),
      include_tolerance: String(includeTolerance),
      district,
      wbs,
      require_direct_contact: String(requireDirectContact),
      sort,
      search: search.trim(),
    });
    return params.toString();
  }, [
    city,
    bgSize,
    benefitType,
    privateOnly,
    includeTolerance,
    district,
    wbs,
    requireDirectContact,
    sort,
    search,
  ]);

  const loadHousingList = useCallback(async () => {
    if (!isOrgActive) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/housing-list?${queryString}`, {
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Wohnungsliste konnte nicht geladen werden.');
      }
      setData(json as HousingListResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Wohnungsliste.');
    } finally {
      setLoading(false);
    }
  }, [isOrgActive, queryString]);

  useEffect(() => {
    loadHousingList();
  }, [loadHousingList]);

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    setError(null);
    try {
      const res = await fetch(`/api/org/housing-list/pdf?${queryString}`);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'PDF-Export fehlgeschlagen.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeCity = city.toLowerCase().replace(/[^a-z0-9]+/gi, '_');
      link.href = url;
      link.download = `Wohnungsliste_${safeCity}_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF-Export fehlgeschlagen.');
    } finally {
      setDownloadingPdf(false);
    }
  }

  if (!isOrgActive) {
    const expiredDate = user.org_license_expires_at
      ? new Date(user.org_license_expires_at).toLocaleDateString('de-DE')
      : null;

    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 text-amber-100">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="space-y-3">
            <h2 className="text-lg font-bold text-white">
              {user.org_status === 'revoked'
                ? 'Organisations-Lizenz wurde widerrufen'
                : user.org_status === 'expired'
                  ? `Organisations-Lizenz abgelaufen${expiredDate ? ` (seit ${expiredDate})` : ''}`
                  : 'Kein aktives Organisationsprofil'}
            </h2>
            <p className="text-sm text-amber-100/90">
              {user.org_status === 'expired' || user.org_status === 'revoked'
                ? 'Deine Organisations-Lizenz ist aktuell nicht mehr aktiv. Um weiterhin Wohnungslisten zusammenzustellen und als druckbare PDF zu exportieren, gib bitte einen neuen Organisations-Key ein oder kontaktiere die Administration zur Verlängerung.'
                : 'Aktiviere zunächst einen Organisations-Key im Menü „Organisation anmelden“ in deinem Profilbereich.'}
            </p>
            <button
              type="button"
              onClick={onGoToOrgActivation}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400"
            >
              <KeyRound className="h-4 w-4" />
              Zu „Organisation anmelden“ &amp; Lizenz erneuern
            </button>
          </div>
        </div>
      </div>
    );
  }

  const org = data?.organization || {
    name: user.org_name || user.full_name || 'Organisation',
    subtitle: user.org_subtitle || '',
    logo_url: user.org_logo_url || '',
    contact: user.org_contact || '',
    license_unlimited: Boolean(user.org_license_unlimited),
    license_expires_at: user.org_license_expires_at || null,
  };

  const items = data?.items || [];

  return (
    <div className="space-y-6">
      {/* Branded Organization Header Card */}
      <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30 p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            {org.logo_url ? (
              <img
                src={org.logo_url}
                alt={org.name}
                className="h-14 w-14 rounded-xl border border-slate-700 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                <Building2 className="h-7 w-7" />
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                  Organisations-Wohnungsliste
                </span>
                <span className="rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[11px] text-slate-300">
                  {org.license_unlimited
                    ? 'Lizenz: Unbegrenzt gültig'
                    : org.license_expires_at
                      ? `Lizenz gültig bis ${new Date(org.license_expires_at).toLocaleDateString('de-DE')}`
                      : 'Lizenz aktiv'}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-bold text-white">{org.name}</h2>
              {(org.subtitle || org.contact) && (
                <p className="text-xs text-slate-300">
                  {[org.subtitle, org.contact].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={onGoToOrgActivation}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Settings className="h-3.5 w-3.5" />
              Org-Einstellungen &amp; Logo
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <Printer className="h-3.5 w-3.5" />
              Druckansicht
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf || loading}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {downloadingPdf ? 'PDF wird erstellt...' : 'Als PDF herunterladen'}
            </button>
          </div>
        </div>
      </div>

      {/* Filter Panel */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 print:hidden">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <FileText className="h-4 w-4 text-emerald-400" />
            <span>Gebiet &amp; Parameter für Wohnungsliste festlegen</span>
          </div>
          <button
            type="button"
            onClick={loadHousingList}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Stadt / Gebiet</label>
            <select
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setDistrict('all');
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {(cities.length > 0 ? cities : ['Gelsenkirchen']).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Stadtteil</label>
            <select
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="all">Alle Stadtteile</option>
              {(data?.districts || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Haushaltsgröße (KdU-Filter)
            </label>
            <select
              value={bgSize}
              onChange={(e) => setBgSize(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value={0}>Alle Größen (vollständige Gebietsliste)</option>
              {[1, 2, 3, 4, 5, 6].map((size) => (
                <option key={size} value={size}>
                  {size} {size === 1 ? 'Person' : 'Personen'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Sortierung</label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as 'newest' | 'cheapest' | 'largest')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="cheapest">Günstigste Miete zuerst</option>
              <option value="newest">Neueste Angebote zuerst</option>
              <option value="largest">Größte Wohnfläche zuerst</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">WBS-Filter</label>
            <select
              value={wbs}
              onChange={(e) => setWbs(e.target.value as 'all' | 'without' | 'only')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="all">Alle (mit &amp; ohne WBS)</option>
              <option value="without">Nur ohne WBS</option>
              <option value="only">Nur mit WBS</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Rechtskreis</label>
            <select
              value={benefitType}
              onChange={(e) => setBenefitType(e.target.value as 'sgb2' | 'sgb12')}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="sgb2">SGB II (Jobcenter / Bürgergeld)</option>
              <option value="sgb12">SGB XII (Sozialamt)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-400">
              Stichwort / Straße / Kontakt-Suche
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="z. B. Buer, Balkon, Erdgeschoss, Ansprechpartner..."
                className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-800 pt-3 text-xs text-slate-300">
          <label className="flex cursor-pointer items-center gap-2 font-semibold text-emerald-300">
            <input
              type="checkbox"
              checked={requireDirectContact}
              onChange={(e) => setRequireDirectContact(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span>
              Nur Angebote mit direktem Kontakt (Telefon oder E-Mail) für Offline-Druckliste
            </span>
          </label>

          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={privateOnly}
              onChange={(e) => setPrivateOnly(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            <span>Nur Privatvermieter</span>
          </label>

          {bgSize > 0 && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={includeTolerance}
                onChange={(e) => setIncludeTolerance(e.target.checked)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span>+10 % Toleranz einschließen</span>
            </label>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Summary & Printable Table */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 print:border-slate-300 print:bg-white print:text-black">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-white print:text-black">
              Aktive Wohnungsliste: {city}
              {district !== 'all' ? ` (${district})` : ''}
            </h3>
            <p className="text-xs text-slate-400 print:text-slate-600">
              Angezeigt: <strong className="text-white print:text-black">{data?.total ?? 0}</strong>{' '}
              Wohnungen · Im Gebiet mit direktem Telefon/Mail-Kontakt:{' '}
              <strong className="text-emerald-400 print:text-black">
                {data?.total_direct_contact ?? 0}
              </strong>{' '}
              von {data?.total_all ?? 0} aktiven Inseraten
              {data?.rule
                ? ` · KdU-Richtwert (${bgSize} Pers.): max. ${Number(data.rule.max_bruttokalt_eur).toFixed(2)} € Bruttokalt`
                : ''}
            </p>
          </div>
          <span className="text-xs text-slate-500">
            Stand: {new Date().toLocaleDateString('de-DE')}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Wohnungsliste wird zusammengestellt...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center text-sm text-slate-400">
            Keine passenden Angebote für diese Filterkombination gefunden.
            {requireDirectContact && (data?.total_all ?? 0) > 0 && (
              <div className="mt-2 text-xs text-slate-500">
                Hinweis: Es gibt {data?.total_all} Angebote im Gebiet, jedoch aktuell ohne
                auslesbare Telefonnummer oder E-Mail-Adresse. Deaktiviere bei Bedarf die Option
                „Nur Angebote mit direktem Kontakt“, oder nutze den PDF-Export nach einem
                Kontakt-Sync.
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 print:border-slate-300 print:text-slate-700">
                  <th className="py-2.5 pr-3 font-semibold">#</th>
                  <th className="py-2.5 pr-3 font-semibold">Wohnung / Quelle</th>
                  <th className="py-2.5 pr-3 font-semibold">Stadtteil / PLZ</th>
                  <th className="py-2.5 pr-3 font-semibold">Größe / Zimmer</th>
                  <th className="py-2.5 pr-3 font-semibold">Bruttokalt</th>
                  <th className="py-2.5 pr-3 font-semibold">Direktkontakt (Tel / E-Mail)</th>
                  <th className="py-2.5 font-semibold">Offline-Status / Notiz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 print:divide-slate-300">
                {items.map((item, idx) => (
                  <tr key={item.id} className="align-top hover:bg-slate-800/30">
                    <td className="py-3 pr-3 font-mono text-slate-400 print:text-black">
                      {idx + 1}
                    </td>
                    <td className="max-w-xs py-3 pr-3">
                      <div className="font-semibold text-white print:text-black">{item.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 print:text-slate-700">
                        <span className="uppercase">{item.portal}</span>
                        {item.is_private_landlord && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300 print:border print:border-slate-400 print:text-black">
                            Privat
                          </span>
                        )}
                        {item.wbs_required && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300 print:border print:border-slate-400 print:text-black">
                            WBS
                          </span>
                        )}
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-400 hover:underline print:hidden"
                        >
                          Inserat
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </td>
                    <td className="py-3 pr-3 text-slate-200 print:text-black">
                      <div>{item.district || item.city}</div>
                      <div className="text-[11px] text-slate-400 print:text-slate-600">
                        {item.zipcode || 'k. A.'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 text-slate-200 print:text-black">
                      <div>{item.sqm ? `${item.sqm} m²` : 'k. A.'}</div>
                      <div className="text-[11px] text-slate-400 print:text-slate-600">
                        {item.rooms ? `${item.rooms} Zi.` : 'k. A.'}
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3">
                      <div className="font-bold text-emerald-300 print:text-black">
                        {Number(item.calculated_bruttokalt).toFixed(2)} €
                      </div>
                      <div className="text-[11px] text-slate-400 print:text-slate-600">
                        Kalt {Number(item.cold_rent || 0).toFixed(0)} € + NK{' '}
                        {Number(item.additional_costs || 0).toFixed(0)} €
                      </div>
                    </td>
                    <td className="min-w-[200px] py-3 pr-3 text-slate-200 print:text-black">
                      {item.contact_name && (
                        <div className="font-semibold text-white print:text-black">
                          {item.contact_name}
                        </div>
                      )}
                      {item.contact_phone && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-emerald-300 print:text-black">
                          <Phone className="h-3 w-3 shrink-0" />
                          <span>{item.contact_phone}</span>
                        </div>
                      )}
                      {item.contact_email && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-sky-300 print:text-black">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="break-all">{item.contact_email}</span>
                        </div>
                      )}
                      {!item.contact_phone && !item.contact_email && (
                        <span className="text-slate-500">Nur über Portal-Nachricht</span>
                      )}
                    </td>
                    <td className="min-w-[165px] py-3 text-[11px] text-slate-400 print:text-black">
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-3 w-3 shrink-0" />
                        <span>Angerufen / Besichtigung</span>
                      </div>
                      <div className="mt-2 border-b border-dashed border-slate-700 pb-2 print:border-slate-400">
                        Notiz:
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

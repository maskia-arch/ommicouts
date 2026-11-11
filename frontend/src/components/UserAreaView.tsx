'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Link2,
  Save,
  Trash2,
  User,
} from 'lucide-react';
import type {
  ApplicationStatus,
  PortalKey,
  PortalLinkMap,
  UserApplication,
  UserProfile,
} from '@/types/immo';

interface UserAreaViewProps {
  user: UserProfile;
  cities: string[];
  applications: UserApplication[];
  onUserUpdated: (user: UserProfile) => void;
  onApplicationsChanged: () => void;
  onBackToSearch: () => void;
}

const PORTAL_CATALOG: Array<{
  key: PortalKey;
  label: string;
  loginUrl: string;
  hint: string;
}> = [
  {
    key: 'kleinanzeigen',
    label: 'Kleinanzeigen',
    loginUrl: 'https://www.kleinanzeigen.de/m-einloggen.html',
    hint: 'Meiste Privatvermieter & WBS-Wohnungen',
  },
  {
    key: 'immowelt',
    label: 'Immowelt',
    loginUrl: 'https://www.immowelt.de/',
    hint: 'Großes Angebot inkl. private & gewerbliche Anbieter',
  },
  {
    key: 'ohne_makler',
    label: 'Ohne-Makler.net',
    loginUrl: 'https://www.ohne-makler.net/accounts/login/',
    hint: '100 % direkte Privatvermieter ohne Makler',
  },
  {
    key: 'ggw',
    label: 'GGW Gelsenkirchen',
    loginUrl: 'https://www.ggw-gelsenkirchen.de/mietangebote/',
    hint: 'Städtische Wohnungen & WBS (Direktformular)',
  },
  {
    key: 'immoscout',
    label: 'ImmoScout24',
    loginUrl: 'https://www.immobilienscout24.de/',
    hint: 'Optional für eigene Direkt-Bewerbungen',
  },
];

const APP_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: 'Vorgemerkt',
  contacted: 'Kontaktiert',
  viewing: 'Besichtigung',
  accepted: 'Zusage',
  rejected: 'Absage',
};

export function UserAreaView({
  user,
  cities,
  applications,
  onUserUpdated,
  onApplicationsChanged,
  onBackToSearch,
}: UserAreaViewProps) {
  const [fullName, setFullName] = useState(user.full_name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [preferredCity, setPreferredCity] = useState(user.preferred_city || 'Gelsenkirchen');
  const [bgSize, setBgSize] = useState(user.bg_size || 1);
  const [benefitType, setBenefitType] = useState<'sgb2' | 'sgb12'>(user.benefit_type || 'sgb2');
  const [moveInDate, setMoveInDate] = useState(user.move_in_date || 'ab sofort / nach Absprache');
  const [personalNote, setPersonalNote] = useState(user.personal_note || '');
  const [emphasizeDirectTransfer, setEmphasizeDirectTransfer] = useState(
    user.emphasize_direct_transfer ?? true
  );
  const [addressSchufaDirectly, setAddressSchufaDirectly] = useState(
    user.address_schufa_directly ?? true
  );
  const [linkedPortals, setLinkedPortals] = useState<PortalLinkMap>(user.linked_portals);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSavingProfile(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          phone,
          preferred_city: preferredCity,
          bg_size: bgSize,
          benefit_type: benefitType,
          move_in_date: moveInDate,
          personal_note: personalNote,
          emphasize_direct_transfer: emphasizeDirectTransfer,
          address_schufa_directly: addressSchufaDirectly,
          linked_portals: linkedPortals,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Speichern fehlgeschlagen.');
      onUserUpdated(json.user);
      setFeedback({ type: 'ok', text: 'Profil & Portal-Verknüpfungen wurden gespeichert.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Fehler beim Speichern',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPw(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Passwortänderung fehlgeschlagen.');
      setCurrentPassword('');
      setNewPassword('');
      setFeedback({ type: 'ok', text: 'Passwort erfolgreich geändert.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Passwortänderung fehlgeschlagen',
      });
    } finally {
      setSavingPw(false);
    }
  };

  const handleUpdateApplication = async (
    appId: string,
    patch: { status?: ApplicationStatus; notes?: string }
  ) => {
    try {
      const res = await fetch(`/api/me/applications/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) onApplicationsChanged();
    } catch {
      // ignore
    }
  };

  const handleDeleteApplication = async (appId: string) => {
    try {
      const res = await fetch(`/api/me/applications/${appId}`, { method: 'DELETE' });
      if (res.ok) onApplicationsChanged();
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div>
          <h1 className="text-lg font-extrabold text-white">Mein Bereich ({user.email})</h1>
          <p className="text-xs text-slate-400">
            Bewerber-Stammdaten, Portal-Konten und deine kontaktierten Wohnungen auf einen Blick.
          </p>
        </div>
        <button
          type="button"
          onClick={onBackToSearch}
          className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
        >
          Zurück zur Wohnungssuche
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Portal-Verknüpfungsstatus */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <Link2 className="h-4 w-4 text-emerald-400" />
              Portal-Konten für Kontaktaufnahme vorbereiten
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Aus Sicherheitsgründen speichern wir hier keine fremden Portal-Passwörter. Öffne die Portale in deinem Browser, logge dich dort einmal ein und markiere sie hier als verknüpft.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleSaveProfile()}
            disabled={savingProfile}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            Portal-Status speichern
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PORTAL_CATALOG.map((p) => {
            const state = linkedPortals[p.key] || { linked: false, account_label: '' };
            return (
              <div
                key={p.key}
                className={`rounded-xl border p-3.5 transition ${
                  state.linked
                    ? 'border-emerald-500/40 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-bold text-white">
                      {p.label}
                      {state.linked && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">{p.hint}</p>
                  </div>
                  <a
                    href={p.loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700"
                  >
                    Login
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-3 space-y-2">
                  <input
                    type="text"
                    value={state.account_label || ''}
                    onChange={(e) =>
                      setLinkedPortals((prev) => ({
                        ...prev,
                        [p.key]: {
                          ...prev[p.key],
                          account_label: e.target.value,
                        },
                      }))
                    }
                    placeholder="Konto-Hinweis (z.B. max@mail.de)"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
                    <input
                      type="checkbox"
                      checked={Boolean(state.linked)}
                      onChange={(e) =>
                        setLinkedPortals((prev) => ({
                          ...prev,
                          [p.key]: {
                            ...prev[p.key],
                            linked: e.target.checked,
                            updated_at: new Date().toISOString(),
                          },
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                    />
                    Im Browser angemeldet &amp; verknüpft
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Meine Bewerbungen & Merkliste */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold text-white">
          Meine Bewerbungen &amp; Merkliste ({applications.length})
        </h2>

        {applications.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
            Noch keine kontaktierten oder gemerkten Wohnungen. Wähle auf der Suchseite eine Wohnung aus und klicke auf „Kontakt &amp; Bewerbung“.
          </div>
        ) : (
          <div className="space-y-2.5">
            {applications.map((app) => (
              <div
                key={app.id}
                className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate text-sm font-bold text-white hover:text-emerald-300"
                    >
                      {app.title}
                    </a>
                    <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      {app.portal}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span>
                      {app.zipcode ? `${app.zipcode} ` : ''}
                      {app.district || app.city}
                    </span>
                    {app.calculated_bruttokalt !== null && (
                      <span>
                        Bruttokalt: {Number(app.calculated_bruttokalt).toFixed(2).replace('.', ',')} €
                      </span>
                    )}
                    {app.sqm !== null && <span>{app.sqm} m²</span>}
                    {app.contacted_at && (
                      <span>
                        Kontaktiert: {new Date(app.contacted_at).toLocaleString('de-DE')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={app.application_status}
                    onChange={(e) =>
                      handleUpdateApplication(app.id, {
                        status: e.target.value as ApplicationStatus,
                      })
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {(Object.keys(APP_STATUS_LABELS) as ApplicationStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {APP_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Inserat
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDeleteApplication(app.id)}
                    className="rounded-lg border border-rose-500/30 p-1.5 text-rose-400 hover:bg-rose-500/15"
                    title="Aus Liste entfernen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Stammdaten & Passwort */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <form
          onSubmit={handleSaveProfile}
          className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 lg:col-span-2"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <User className="h-4 w-4 text-emerald-400" />
            Bewerber-Profil &amp; Standard-Anschreiben
          </h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-slate-400">Vor- und Nachname</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Telefonnummer</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Such-Stadt</label>
              <select
                value={preferredCity}
                onChange={(e) => setPreferredCity(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {(cities.length ? cities : ['Gelsenkirchen']).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Haushaltsgröße (BG)</label>
              <select
                value={bgSize}
                onChange={(e) => setBgSize(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'Person' : 'Personen'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Leistungsart</label>
              <select
                value={benefitType}
                onChange={(e) => setBenefitType(e.target.value === 'sgb12' ? 'sgb12' : 'sgb2')}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              >
                <option value="sgb2">Bürgergeld (SGB II)</option>
                <option value="sgb12">Sozialhilfe (SGB XII)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Wunsch-Einzugsdatum</label>
              <input
                type="text"
                value={moveInDate}
                onChange={(e) => setMoveInDate(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Kurzvorstellung für Bewerbungen
            </label>
            <textarea
              rows={2}
              value={personalNote}
              onChange={(e) => setPersonalNote(e.target.value)}
              placeholder="z.B. ruhige Einzelperson, Nichtraucher, keine Haustiere"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={emphasizeDirectTransfer}
                onChange={(e) => setEmphasizeDirectTransfer(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
              />
              Direktabtretung im Text anbieten
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={addressSchufaDirectly}
                onChange={(e) => setAddressSchufaDirectly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
              />
              Schufa-Hinweis automatisch einfügen
            </label>
          </div>

          <button
            type="submit"
            disabled={savingProfile}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {savingProfile ? 'Speichere...' : 'Profil speichern'}
          </button>
        </form>

        <form
          onSubmit={handleChangePassword}
          className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-white">
            <KeyRound className="h-4 w-4 text-amber-400" />
            Passwort ändern
          </h2>

          <div>
            <label className="mb-1 block text-xs text-slate-400">Aktuelles Passwort</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-400">
              Neues Passwort (mind. 8 Zeichen)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={savingPw}
            className="w-full rounded-xl border border-amber-400/40 bg-amber-500/15 py-2.5 text-sm font-bold text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-60"
          >
            {savingPw ? 'Aktualisiere...' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}

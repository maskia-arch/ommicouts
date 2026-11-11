'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  KeyRound,
  Link2,
  Mail,
  Phone,
  Save,
  Search,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import type {
  ApplicationStatus,
  HiddenListingItem,
  PortalKey,
  PortalLinkMap,
  UserApplication,
  UserProfile,
} from '@/types/immo';

interface UserAreaViewProps {
  user: UserProfile;
  cities: string[];
  applications: UserApplication[];
  hiddenListings: HiddenListingItem[];
  onUserUpdated: (user: UserProfile) => void;
  onApplicationsChanged: () => void;
  onHiddenListingsChanged: () => void;
  onBackToSearch: () => void;
  onGoToOrgList?: () => void;
  openOrgSignal?: number;
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

const APP_STATUS_PRIORITY: Record<ApplicationStatus, number> = {
  accepted: 1,
  viewing: 2,
  contacted: 3,
  saved: 4,
  rejected: 5,
};

const APP_STATUS_BADGES: Record<ApplicationStatus, string> = {
  accepted: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  viewing: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  contacted: 'border-teal-500/40 bg-teal-500/15 text-teal-300',
  saved: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  rejected: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
};

const FOLDER_TABS: Array<{ key: 'all' | ApplicationStatus; label: string }> = [
  { key: 'all', label: 'Alle' },
  { key: 'accepted', label: 'Zusage' },
  { key: 'viewing', label: 'Besichtigung' },
  { key: 'contacted', label: 'Kontaktiert' },
  { key: 'saved', label: 'Vorgemerkt' },
  { key: 'rejected', label: 'Absage' },
];

export function UserAreaView({
  user,
  cities,
  applications,
  hiddenListings,
  onUserUpdated,
  onApplicationsChanged,
  onHiddenListingsChanged,
  onBackToSearch,
  onGoToOrgList,
  openOrgSignal = 0,
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

  // Persönlicher Wohnungsordner
  const [folderTab, setFolderTab] = useState<'all' | ApplicationStatus>('all');
  const [folderSort, setFolderSort] = useState<
    'status_priority' | 'updated_desc' | 'price_asc' | 'sqm_desc'
  >('status_priority');
  const [folderSearch, setFolderSearch] = useState('');
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  // Organisation anmelden & Einstellungen
  const [orgMenuOpen, setOrgMenuOpen] = useState(
    user.account_type === 'organization' || openOrgSignal > 0
  );
  const orgSectionRef = useRef<HTMLDivElement | null>(null);
  const [orgKeyInput, setOrgKeyInput] = useState('');
  const [activatingOrg, setActivatingOrg] = useState(false);
  const [orgName, setOrgName] = useState(user.org_name || '');
  const [orgSubtitle, setOrgSubtitle] = useState(user.org_subtitle || '');
  const [orgContact, setOrgContact] = useState(user.org_contact || '');
  const [orgLogoUrl, setOrgLogoUrl] = useState(user.org_logo_url || '');
  const [savingOrgSettings, setSavingOrgSettings] = useState(false);

  useEffect(() => {
    setOrgName(user.org_name || '');
    setOrgSubtitle(user.org_subtitle || '');
    setOrgContact(user.org_contact || '');
    setOrgLogoUrl(user.org_logo_url || '');
  }, [user.org_name, user.org_subtitle, user.org_contact, user.org_logo_url]);

  useEffect(() => {
    if (openOrgSignal > 0) {
      setOrgMenuOpen(true);
      setTimeout(() => {
        orgSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 60);
    }
  }, [openOrgSignal]);

  const statusCounts = useMemo(() => {
    const counts: Record<'all' | ApplicationStatus, number> = {
      all: applications.length,
      accepted: 0,
      viewing: 0,
      contacted: 0,
      saved: 0,
      rejected: 0,
    };
    for (const app of applications) {
      counts[app.application_status] = (counts[app.application_status] || 0) + 1;
    }
    return counts;
  }, [applications]);

  const sortedFilteredApplications = useMemo(() => {
    const q = folderSearch.trim().toLowerCase();
    const list = applications.filter((app) => {
      if (folderTab !== 'all' && app.application_status !== folderTab) return false;
      if (!q) return true;
      const haystack = [
        app.title,
        app.district,
        app.city,
        app.zipcode,
        app.notes,
        app.contact_name,
        app.contact_phone,
        app.contact_email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    list.sort((a, b) => {
      if (folderSort === 'price_asc') {
        return Number(a.calculated_bruttokalt ?? 999999) - Number(b.calculated_bruttokalt ?? 999999);
      }
      if (folderSort === 'sqm_desc') {
        return Number(b.sqm ?? 0) - Number(a.sqm ?? 0);
      }
      if (folderSort === 'updated_desc') {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      }
      const pDiff =
        (APP_STATUS_PRIORITY[a.application_status] ?? 9) -
        (APP_STATUS_PRIORITY[b.application_status] ?? 9);
      if (pDiff !== 0) return pDiff;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

    return list;
  }, [applications, folderTab, folderSort, folderSearch]);

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

  const handleSaveApplicationNote = async (app: UserApplication) => {
    const nextNote = draftNotes[app.id] ?? app.notes ?? '';
    setSavingNoteId(app.id);
    try {
      await handleUpdateApplication(app.id, { notes: nextNote });
      setFeedback({ type: 'ok', text: `Notiz für „${app.title.slice(0, 45)}“ gespeichert.` });
    } finally {
      setSavingNoteId(null);
    }
  };

  const handleUnhideListing = async (listingId: string) => {
    try {
      const res = await fetch(`/api/me/hidden-listings/${listingId}`, { method: 'DELETE' });
      if (res.ok) {
        onHiddenListingsChanged();
        setFeedback({ type: 'ok', text: 'Anzeige wieder in deiner Übersicht eingeblendet.' });
      }
    } catch {
      // ignore
    }
  };

  const handleActivateOrgKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgKeyInput.trim()) return;
    setActivatingOrg(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/me/organization/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: orgKeyInput.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Key-Aktivierung fehlgeschlagen.');
      onUserUpdated(json.user);
      setOrgKeyInput('');
      setFeedback({
        type: 'ok',
        text: 'Organisations-Lizenz aktiviert! Dein Konto verfügt nun über die Wohnungsliste & PDF-Export.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Key-Aktivierung fehlgeschlagen.',
      });
    } finally {
      setActivatingOrg(false);
    }
  };

  const handleSaveOrgSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOrgSettings(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/me/organization/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_name: orgName,
          org_subtitle: orgSubtitle,
          org_contact: orgContact,
          org_logo_url: orgLogoUrl,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Org-Einstellungen konnten nicht gespeichert werden.');
      onUserUpdated(json.user);
      setFeedback({ type: 'ok', text: 'Organisations-Branding & Einstellungen gespeichert.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Speichern der Org-Einstellungen fehlgeschlagen.',
      });
    } finally {
      setSavingOrgSettings(false);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 240;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUri = canvas.toDataURL('image/png');
        if (dataUri.length > 350_000) {
          setFeedback({ type: 'err', text: 'Logo-Datei ist auch verkleinert zu groß.' });
          return;
        }
        setOrgLogoUrl(dataUri);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
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

      {/* Persönlicher Wohnungsordner (sortiert nach Bearbeitungsstand) */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="mb-4 flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <FolderKanban className="h-4 w-4 text-emerald-400" />
              Mein Wohnungsordner ({applications.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Sortiert und gegliedert nach deinem persönlichen Bearbeitungsstand inklusive Notizen &amp; Direktkontakten.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={folderSearch}
                onChange={(e) => setFolderSearch(e.target.value)}
                placeholder="Ordner durchsuchen..."
                className="rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-2.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <select
              value={folderSort}
              onChange={(e) =>
                setFolderSort(
                  e.target.value as 'status_priority' | 'updated_desc' | 'price_asc' | 'sqm_desc'
                )
              }
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="status_priority">Sortierung: Bearbeitungsstand (Zusage zuerst)</option>
              <option value="updated_desc">Sortierung: Zuletzt bearbeitet</option>
              <option value="price_asc">Sortierung: Günstigste Bruttokaltmiete</option>
              <option value="sqm_desc">Sortierung: Größte Wohnfläche</option>
            </select>
          </div>
        </div>

        {/* Status-Ordner-Tabs */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FOLDER_TABS.map((tab) => {
            const active = folderTab === tab.key;
            const count = statusCounts[tab.key] || 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFolderTab(tab.key)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200'
                    : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <span>{tab.label}</span>
                <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {sortedFilteredApplications.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-center text-xs text-slate-400">
            {applications.length === 0
              ? 'Noch keine gemerkten oder markierten Wohnungen in deinem Ordner. Nutze auf der Suchseite das Status-Menü auf einer Wohnungskarte.'
              : 'Keine Wohnungen in diesem Ordner-Filter gefunden.'}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFilteredApplications.map((app) => {
              const noteValue = draftNotes[app.id] ?? app.notes ?? '';
              const noteDirty = noteValue !== (app.notes ?? '');
              return (
                <div
                  key={app.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5"
                >
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${APP_STATUS_BADGES[app.application_status]}`}
                        >
                          {APP_STATUS_LABELS[app.application_status]}
                        </span>
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

                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        <span>
                          {app.zipcode ? `${app.zipcode} ` : ''}
                          {app.district || app.city}
                        </span>
                        {app.calculated_bruttokalt !== null && (
                          <span className="font-semibold text-slate-200">
                            Bruttokalt: {Number(app.calculated_bruttokalt).toFixed(2).replace('.', ',')} €
                          </span>
                        )}
                        {app.sqm !== null && <span>{app.sqm} m²</span>}
                        {app.rooms !== null && <span>{app.rooms} Zi.</span>}
                        <span>Aktualisiert: {new Date(app.updated_at).toLocaleDateString('de-DE')}</span>
                      </div>

                      {(app.contact_phone || app.contact_email || app.contact_name) && (
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                          {app.contact_name && (
                            <span className="text-slate-300">Kontakt: {app.contact_name}</span>
                          )}
                          {app.contact_phone && (
                            <a
                              href={`tel:${app.contact_phone}`}
                              className="inline-flex items-center gap-1 text-emerald-300 hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              {app.contact_phone}
                            </a>
                          )}
                          {app.contact_email && (
                            <a
                              href={`mailto:${app.contact_email}`}
                              className="inline-flex items-center gap-1 text-sky-300 hover:underline"
                            >
                              <Mail className="h-3 w-3" />
                              {app.contact_email}
                            </a>
                          )}
                        </div>
                      )}
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
                        title="Aus Ordner entfernen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Persönliche Notiz */}
                  <div className="mt-2.5 flex flex-col gap-2 border-t border-slate-800/80 pt-2.5 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={noteValue}
                      onChange={(e) =>
                        setDraftNotes((prev) => ({ ...prev, [app.id]: e.target.value }))
                      }
                      placeholder="Persönliche Notiz hinzufügen (z. B. Besichtigungstermin, Ansprechpartner, Rückruf)..."
                      className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                    {noteDirty && (
                      <button
                        type="button"
                        disabled={savingNoteId === app.id}
                        onClick={() => handleSaveApplicationNote(app)}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        <Save className="h-3 w-3" />
                        {savingNoteId === app.id ? 'Speichere...' : 'Notiz speichern'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Vom Nutzer selbst ausgeblendete Anzeigen */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <EyeOff className="h-4 w-4 text-slate-400" />
              Ausgeblendete Anzeigen ({hiddenListings.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Anzeigen, die du für deine Übersicht ausgeblendet hast, lassen sich hier jederzeit wieder einblenden.
            </p>
          </div>
        </div>

        {hiddenListings.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-500">
            Aktuell sind keine Wohnungen ausgeblendet.
          </div>
        ) : (
          <div className="space-y-2">
            {hiddenListings.map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3.5 py-2.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-slate-200">{item.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span>
                      {item.zipcode ? `${item.zipcode} ` : ''}
                      {item.district || item.city}
                    </span>
                    {item.calculated_bruttokalt !== null && (
                      <span>{Number(item.calculated_bruttokalt).toFixed(0)} € Bruttokalt</span>
                    )}
                    {item.sqm !== null && <span>{item.sqm} m²</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnhideListing(item.listing_id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Wieder einblenden
                </button>
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

      {/* Versteckter / dezenter Bereich: Organisation anmelden & Lizenzverwaltung */}
      <div
        ref={orgSectionRef}
        className="rounded-2xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 sm:px-5"
      >
        <button
          type="button"
          onClick={() => setOrgMenuOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 text-left text-xs text-slate-400 transition hover:text-slate-200"
        >
          <span className="flex items-center gap-2 font-semibold">
            <Building2 className="h-3.5 w-3.5 text-slate-500" />
            <span>Für Beratungsstellen, Träger &amp; Kommunen · Organisation anmelden</span>
            {user.account_type === 'organization' && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  user.org_status === 'active'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {user.org_status === 'active'
                  ? 'Org aktiv'
                  : user.org_status === 'revoked'
                    ? 'Widerrufen'
                    : 'Abgelaufen'}
              </span>
            )}
          </span>
          {orgMenuOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-500" />
          )}
        </button>

        {orgMenuOpen && (
          <div className="mt-4 space-y-5 border-t border-slate-800 pt-4">
            {(user.org_status === 'expired' || user.org_status === 'revoked') && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-100">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <div className="font-bold text-white">
                    {user.org_status === 'revoked'
                      ? 'Organisations-Lizenz wurde widerrufen'
                      : 'Deine Organisations-Lizenz ist abgelaufen'}
                  </div>
                  <p className="mt-1 text-amber-100/90">
                    {user.org_license_expires_at
                      ? `Gültigkeit endete am ${new Date(user.org_license_expires_at).toLocaleString('de-DE')}. `
                      : ''}
                    Bitte aktiviere hier einen neuen Organisations-Key oder lass deinen Key durch den Administrator verlängern, um wieder PDF-Wohnungslisten erstellen zu können.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <form
                onSubmit={handleActivateOrgKey}
                className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <KeyRound className="h-4 w-4 text-emerald-400" />
                    Organisations-Key aktivieren / erneuern
                  </h3>
                  {user.org_key_prefix && (
                    <span className="font-mono text-[11px] text-slate-400">
                      Key: {user.org_key_prefix}…
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  Du hast einen Organisations-Schlüssel erhalten? Gib ihn hier ein, um dein Profil dauerhaft oder zeitlich befristet als Organisation freizuschalten.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    value={orgKeyInput}
                    onChange={(e) => setOrgKeyInput(e.target.value)}
                    placeholder="ORG-XXXX-XXXX-XXXX"
                    className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs uppercase text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={activatingOrg || !orgKeyInput.trim()}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {activatingOrg ? 'Prüfe Key...' : 'Key aktivieren'}
                  </button>
                </div>

                {user.org_status === 'active' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    <span>
                      Status: <strong>Aktiv</strong> ·{' '}
                      {user.org_license_unlimited
                        ? 'Unbegrenzte Gültigkeit'
                        : user.org_license_expires_at
                          ? `Gültig bis ${new Date(user.org_license_expires_at).toLocaleDateString('de-DE')}`
                          : 'Zeitlich begrenzt'}
                    </span>
                    {onGoToOrgList && (
                      <button
                        type="button"
                        onClick={onGoToOrgList}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
                      >
                        <FileText className="h-3 w-3" />
                        Zur Wohnungsliste (PDF)
                      </button>
                    )}
                  </div>
                )}
              </form>

              {user.org_status === 'active' && (
                <form
                  onSubmit={handleSaveOrgSettings}
                  className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                >
                  <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                    <Building2 className="h-4 w-4 text-sky-400" />
                    Organisations-Einstellungen (für PDF-Wohnungsliste)
                  </h3>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Organisationsname *
                      </label>
                      <input
                        type="text"
                        required
                        value={orgName}
                        onChange={(e) => setOrgName(e.target.value)}
                        placeholder="z. B. Caritas Sozialberatung GE"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Untertitel / Fachbereich
                      </label>
                      <input
                        type="text"
                        value={orgSubtitle}
                        onChange={(e) => setOrgSubtitle(e.target.value)}
                        placeholder="z. B. Fachstelle Wohnungsnot"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Organisations-Kontakt (auf PDF-Kopfzeile)
                    </label>
                    <input
                      type="text"
                      value={orgContact}
                      onChange={(e) => setOrgContact(e.target.value)}
                      placeholder="z. B. Tel. 0209 12345 · wohnung@traeger.de"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Logo-URL (https://...) oder Upload
                      </label>
                      <input
                        type="text"
                        value={orgLogoUrl}
                        onChange={(e) => setOrgLogoUrl(e.target.value)}
                        placeholder="https://... oder Bild hochladen"
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Logo hochladen (PNG / JPG)
                      </label>
                      <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-emerald-500">
                        <Upload className="h-3.5 w-3.5" />
                        <span>Bild wählen</span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={handleLogoFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {orgLogoUrl && (
                    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                      <img
                        src={orgLogoUrl}
                        alt="Logo Vorschau"
                        className="h-10 w-10 rounded bg-white object-contain p-0.5"
                      />
                      <span className="flex-1 truncate text-[11px] text-slate-400">
                        Aktives Logo für Wohnungsliste &amp; PDF-Export
                      </span>
                      <button
                        type="button"
                        onClick={() => setOrgLogoUrl('')}
                        className="text-[11px] text-rose-400 hover:underline"
                      >
                        Entfernen
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={savingOrgSettings}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingOrgSettings ? 'Speichere...' : 'Org-Einstellungen speichern'}
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

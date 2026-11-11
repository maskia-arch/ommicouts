'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Building2,
  CheckCircle2,
  ExternalLink,
  Filter,
  Home,
  Info,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  ApplicationStatus,
  KduRule,
  ListingItem,
  ListingsResponse,
  UserApplication,
  UserProfile,
} from '@/types/immo';
import { ApplicationModal } from './ApplicationModal';
import { AuthModal } from './AuthModal';
import { UserAreaView } from './UserAreaView';

const APP_STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'saved', label: 'Vorgemerkt' },
  { value: 'contacted', label: 'Kontaktiert' },
  { value: 'viewing', label: 'Besichtigung' },
  { value: 'accepted', label: 'Zusage' },
  { value: 'rejected', label: 'Absage' },
];

function formatEur(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '–';
  return `${Number(val).toFixed(2).replace('.', ',')} €`;
}

function formatPortal(portal: ListingItem['portal']): string {
  switch (portal) {
    case 'kleinanzeigen':
      return 'Kleinanzeigen';
    case 'immowelt':
      return 'Immowelt';
    case 'immoscout':
      return 'ImmoScout24';
    default:
      return 'Portal';
  }
}

function formatRelativeDate(iso: string): string {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 60) return `vor ${diffMin || 1} Min.`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std.`;
  const diffDays = Math.floor(diffHours / 24);
  return `vor ${diffDays} ${diffDays === 1 ? 'Tag' : 'Tagen'}`;
}

interface ImmoMatcherClientProps {
  initialCities: string[];
  initialData: ListingsResponse | null;
}

export function ImmoMatcherClient({ initialCities, initialData }: ImmoMatcherClientProps) {
  const [cities, setCities] = useState<string[]>(
    initialCities.length > 0 ? initialCities : ['Gelsenkirchen']
  );
  const [city, setCity] = useState<string>(initialData?.city || 'Gelsenkirchen');
  const [benefitType, setBenefitType] = useState<'sgb2' | 'sgb12'>('sgb2');
  const [bgSize, setBgSize] = useState<number>(initialData?.bg_size || 1);
  const [privateOnly, setPrivateOnly] = useState<boolean>(false);
  const [includeTolerance, setIncludeTolerance] = useState<boolean>(false);
  const [district, setDistrict] = useState<string>('all');
  const [wbs, setWbs] = useState<'all' | 'without' | 'only'>('all');
  const [sort, setSort] = useState<'newest' | 'cheapest' | 'largest'>('newest');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const [data, setData] = useState<ListingsResponse | null>(initialData);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingItem | null>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoaded, setAuthLoaded] = useState<boolean>(false);
  const [applications, setApplications] = useState<UserApplication[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [activeView, setActiveView] = useState<'search' | 'account'>('search');

  const fetchApplications = useCallback(async () => {
    try {
      const res = await fetch('/api/me/applications', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) {
        setApplications([]);
        return;
      }
      const json = await res.json();
      setApplications(Array.isArray(json.applications) ? json.applications : []);
    } catch {
      setApplications([]);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'include',
      });
      const json = await res.json();
      if (json?.authenticated && json.user) {
        setUser(json.user);
        await fetchApplications();
      } else {
        setUser(null);
        setApplications([]);
      }
    } catch {
      setUser(null);
      setApplications([]);
    } finally {
      setAuthLoaded(true);
    }
  }, [fetchApplications]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const handleAuthSuccess = async (loggedInUser: UserProfile) => {
    setUser(loggedInUser);
    if (loggedInUser.preferred_city && cities.includes(loggedInUser.preferred_city)) {
      setCity(loggedInUser.preferred_city);
    }
    if (loggedInUser.bg_size) setBgSize(loggedInUser.bg_size);
    if (loggedInUser.benefit_type) setBenefitType(loggedInUser.benefit_type);
    setAuthModalOpen(false);
    await fetchApplications();
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    setUser(null);
    setApplications([]);
    setActiveView('search');
  };

  const [updatingListingId, setUpdatingListingId] = useState<string | null>(null);

  const setListingStatus = async (
    item: ListingItem,
    status: ApplicationStatus,
    existing?: UserApplication
  ) => {
    if (!user) return;
    setUpdatingListingId(item.id);
    try {
      if (existing) {
        await fetch(`/api/me/applications/${existing.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status }),
        });
      } else {
        await fetch('/api/me/applications', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ listing_id: item.id, status }),
        });
      }
      await fetchApplications();
    } catch {
      // ignore transient error
    } finally {
      setUpdatingListingId(null);
    }
  };

  const removeListingStatus = async (item: ListingItem, existing: UserApplication) => {
    if (!user) return;
    setUpdatingListingId(item.id);
    try {
      await fetch(`/api/me/applications/${existing.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchApplications();
    } catch {
      // ignore transient error
    } finally {
      setUpdatingListingId(null);
    }
  };

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        city,
        bg_size: String(bgSize),
        benefit_type: benefitType,
        private_only: String(privateOnly),
        include_tolerance: String(includeTolerance),
        district,
        wbs,
        sort,
        page: String(page),
        limit: '24',
      });
      if (search.trim()) params.set('search', search.trim());

      const res = await fetch(`/api/listings?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Fehler beim Laden der Angebote');
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindungsfehler');
    } finally {
      setLoading(false);
    }
  }, [city, bgSize, benefitType, privateOnly, includeTolerance, district, wbs, sort, search, page]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  useEffect(() => {
    fetch('/api/kdu', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (json?.cities?.length) setCities(json.cities);
      })
      .catch(() => undefined);
  }, []);

  const activeRule: KduRule = data?.rule || {
    city,
    bg_size: bgSize,
    max_sqm: 50,
    max_bruttokalt_eur: 367.5,
    extra_person_sqm: 15,
    extra_person_eur: 116.6,
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const applicationsByListingId = new Map(applications.map((a) => [a.listing_id, a]));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
              <Home className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white sm:text-lg">
                  KdU Wohnungs-Matcher
                </span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                  {city}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Jobcenter (SGB II) &amp; Sozialamt (SGB XII) · Fokus Privatvermieter &amp; Schufa-Hilfe
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveView('search')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    activeView === 'search'
                      ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                      : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  Wohnungssuche
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView('account')}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    activeView === 'account'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <User className="h-3.5 w-3.5" />
                  Mein Bereich ({applications.length})
                </button>
                <span className="hidden items-center rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-xs text-slate-300 md:inline-flex">
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Abmelden"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:text-rose-200"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Abmelden</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalMode('login');
                    setAuthModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800"
                >
                  <LogIn className="h-3.5 w-3.5 text-emerald-400" />
                  Anmelden
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthModalMode('register');
                    setAuthModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                >
                  Registrieren
                </button>
              </>
            )}

            <button
              onClick={fetchListings}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Aktualisieren</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {activeView === 'account' && user ? (
          <UserAreaView
            user={user}
            cities={cities}
            applications={applications}
            onUserUpdated={(updated) => setUser(updated)}
            onApplicationsChanged={fetchApplications}
            onBackToSearch={() => setActiveView('search')}
          />
        ) : (
          <>
            {authLoaded && !user && (
              <div className="flex flex-col justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <Lock className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                  <div>
                    <div className="text-sm font-bold text-amber-200">
                      Kontaktfunktion erfordert ein kostenloses Benutzerkonto
                    </div>
                    <p className="mt-0.5 text-xs text-slate-300">
                      Du kannst alle KdU-Wohnungen frei ansehen. Um Vermieter zu kontaktieren,
                      dein Schufa-Killer-Anschreiben zu speichern und Portale zu verknüpfen, melde
                      dich kurz an oder registriere dich mit E-Mail &amp; Passwort.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalMode('login');
                      setAuthModalOpen(true);
                    }}
                    className="rounded-xl border border-amber-400/40 bg-slate-950/70 px-3.5 py-2 text-xs font-semibold text-amber-200 transition hover:bg-slate-900"
                  >
                    Anmelden
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthModalMode('register');
                      setAuthModalOpen(true);
                    }}
                    className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                  >
                    Kostenlos registrieren
                  </button>
                </div>
              </div>
            )}

            {/* Hero + Interactive Configurator */}
        <section className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 p-4 shadow-xl sm:p-6">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h1 className="text-xl font-bold text-white sm:text-2xl">
                Jobcenter-konforme Wohnungen in {city} finden
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Automatisch geprüft gegen die aktuellen KdU-Richtlinien (Bruttokaltmiete &amp;
                Produkttheorie) – inklusive Direktabtretungs-Anschreiben bei negativer Schufa.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            {/* Stadt */}
            <div className="md:col-span-3">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Stadt / Kommune
              </label>
              <select
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setDistrict('all');
                  setPage(1);
                }}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm font-medium text-white focus:border-emerald-500 focus:outline-none"
              >
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Leistungsart */}
            <div className="md:col-span-4">
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                Leistungsart
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBenefitType('sgb2')}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition sm:text-sm ${
                    benefitType === 'sgb2'
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>Bürgergeld</div>
                  <div className="text-[11px] font-normal opacity-80">SGB II · Jobcenter</div>
                </button>
                <button
                  type="button"
                  onClick={() => setBenefitType('sgb12')}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition sm:text-sm ${
                    benefitType === 'sgb12'
                      ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>Grundsicherung</div>
                  <div className="text-[11px] font-normal opacity-80">SGB XII · Sozialamt</div>
                </button>
              </div>
            </div>

            {/* Bedarfsgemeinschaft */}
            <div className="md:col-span-5">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Users className="h-3.5 w-3.5" />
                Größe der Bedarfsgemeinschaft (Personen)
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setBgSize(num);
                      setPage(1);
                    }}
                    className={`h-10 min-w-[42px] flex-1 rounded-xl border text-sm font-bold transition ${
                      bgSize === num
                        ? 'border-emerald-500 bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/30'
                        : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {num === 6 && bgSize > 6 ? `${bgSize}` : num === 6 ? '6+' : num}
                  </button>
                ))}
                <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setBgSize((prev) => Math.max(1, prev - 1));
                      setPage(1);
                    }}
                    aria-label="Person weniger"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBgSize((prev) => Math.min(12, prev + 1));
                      setPage(1);
                    }}
                    aria-label="Weitere Person"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Prominent Toggles */}
          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setPrivateOnly((v) => !v);
                setPage(1);
              }}
              className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition ${
                privateOnly
                  ? 'border-amber-400/80 bg-amber-500/15 shadow-lg shadow-amber-500/10'
                  : 'border-amber-500/30 bg-slate-950/80 hover:border-amber-400/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 rounded-lg p-2 ${
                    privateOnly ? 'bg-amber-400 text-slate-950' : 'bg-amber-500/15 text-amber-300'
                  }`}
                >
                  <UserCheck className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    Nur private Vermieter anzeigen
                    <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                      Schufa-Tipp
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Privatvermieter entscheiden oft menschlicher und akzeptieren Direktabtretung.
                  </p>
                </div>
              </div>
              <div
                className={`ml-3 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                  privateOnly ? 'bg-amber-400' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    privateOnly ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setIncludeTolerance((v) => !v);
                setPage(1);
              }}
              className={`flex items-center justify-between rounded-xl border p-3.5 text-left transition ${
                includeTolerance
                  ? 'border-sky-400/70 bg-sky-500/15'
                  : 'border-slate-800 bg-slate-950/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 rounded-lg p-2 ${
                    includeTolerance ? 'bg-sky-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    Auch geringen Eigenanteil (+10 % Toleranz) zeigen
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Erweitert die Suche bis {formatEur(activeRule.max_bruttokalt_eur * 1.1)} Bruttokaltmiete.
                  </p>
                </div>
              </div>
              <div
                className={`ml-3 h-6 w-11 shrink-0 rounded-full p-0.5 transition ${
                  includeTolerance ? 'bg-sky-400' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`h-5 w-5 rounded-full bg-white transition-transform ${
                    includeTolerance ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          </div>
        </section>

        {/* Transparenz-Ampel Banner */}
        <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-4 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-bold text-emerald-200 sm:text-base">
                  Dein Limit in {city} bei {bgSize}{' '}
                  {bgSize === 1 ? 'Person' : 'Personen'}: max. {activeRule.max_sqm} m² &amp;{' '}
                  <span className="text-white underline decoration-emerald-400 underline-offset-4">
                    {formatEur(activeRule.max_bruttokalt_eur)} Bruttokaltmiete
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-emerald-300/80">
                  Bruttokaltmiete = Kaltmiete + kalte Betriebskosten (ohne Heizkosten).
                  {includeTolerance && data?.tolerance_limit_eur
                    ? ` Mit +10 % Toleranz bis ${formatEur(data.tolerance_limit_eur)}.`
                    : ' Nach BSG-Produkttheorie zählt primär die Gesamtsumme Bruttokalt.'}
                </p>
              </div>
            </div>
            {data && (
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="rounded-lg bg-slate-900/90 px-3 py-1.5 font-semibold text-white ring-1 ring-slate-700">
                  {data.total} Treffer
                </span>
                <span className="rounded-lg bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-300 ring-1 ring-amber-500/30">
                  {data.private_count} Privat
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Secondary Filter Bar */}
        <section className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Suche nach Titel, Stadtteil (z. B. Schalke, Buer) oder PLZ..."
              className="w-full rounded-xl border border-slate-800 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Filter className="h-3.5 w-3.5" />
            </div>
            <select
              value={district}
              onChange={(e) => {
                setDistrict(e.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">Alle Stadtteile</option>
              {(data?.districts || []).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={wbs}
              onChange={(e) => {
                setWbs(e.target.value as 'all' | 'without' | 'only');
                setPage(1);
              }}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">WBS: Alle</option>
              <option value="without">Nur ohne WBS</option>
              <option value="only">Nur mit WBS</option>
            </select>

            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as 'newest' | 'cheapest' | 'largest');
                setPage(1);
              }}
              className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="newest">Neueste zuerst</option>
              <option value="cheapest">Günstigste Bruttokalt</option>
              <option value="largest">Größte m²</option>
            </select>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Results Grid */}
        {!loading && data && data.items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
            <Building2 className="mx-auto h-10 w-10 text-slate-600" />
            <h2 className="mt-3 text-base font-bold text-white">
              Aktuell keine passenden Inserate für diese Filter
            </h2>
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
              Tipp: Aktiviere die +10 % Eigenanteil-Toleranz oder deaktiviere vorübergehend einen
              Stadtteil-Filter. Der Crawler prüft alle 20 Minuten automatisch auf neue Angebote.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(data?.items || []).map((item) => (
              <article
                key={item.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4 transition hover:border-slate-700 sm:p-5"
              >
                <div>
                  {/* Badges */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {item.compliance_status === 'tolerance' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-500/30">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Eigenanteil +{formatEur(item.eigenanteil_eur)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {item.compliance_status === 'produkttheorie'
                          ? 'Jobcenter-Konform (Produkttheorie)'
                          : '100% Jobcenter-Konform'}
                      </span>
                    )}

                    {item.is_private_landlord && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2.5 py-1 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40">
                        <UserCheck className="h-3.5 w-3.5" />
                        Privatvermieter
                      </span>
                    )}

                    {item.wbs_required && (
                      <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-xs font-semibold text-purple-300 ring-1 ring-purple-500/30">
                        WBS erforderlich
                      </span>
                    )}

                    <span className="ml-auto text-[11px] font-medium text-slate-500">
                      {formatPortal(item.portal)} · {formatRelativeDate(item.first_seen_at)}
                    </span>
                  </div>

                  {/* Title & Location */}
                  <h2 className="line-clamp-2 text-base font-bold leading-snug text-white">
                    {item.title}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                      <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                      {item.zipcode ? `${item.zipcode} ` : ''}
                      {item.city}
                      {item.district && item.district !== item.city ? ` – ${item.district}` : ''}
                    </span>
                    {item.sqm !== null && (
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-slate-200">
                        {item.sqm} m²
                      </span>
                    )}
                    {item.rooms !== null && (
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-slate-200">
                        {item.rooms} Zi.
                      </span>
                    )}
                  </div>

                  {/* Rent Breakdown */}
                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <span className="text-xs text-slate-400">Bruttokaltmiete</span>
                        <div className="text-xl font-extrabold text-white">
                          {formatEur(item.calculated_bruttokalt)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <div>
                          Kalt: <span className="font-semibold text-slate-200">{formatEur(item.cold_rent)}</span>
                          {' + '}
                          NK:{' '}
                          <span className="font-semibold text-slate-200">
                            {formatEur(item.additional_costs)}
                          </span>
                        </div>
                        {item.heating_costs > 0 && (
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            + Heizkosten (separat): {formatEur(item.heating_costs)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-4 space-y-2.5">
                  {!user ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Bitte zuerst anmelden, um den Bewerbungstext & Kontakt zu nutzen"
                        className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5 text-xs font-semibold text-slate-500 opacity-75"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Bewerbungstext (Login nötig)
                      </button>

                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Bitte zuerst anmelden, um zur Originalanzeige zu gelangen"
                        className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5 text-xs font-semibold text-slate-500 opacity-75"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Originalanzeige (Login nötig)
                      </button>
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const tracked = applicationsByListingId.get(item.id);
                        const isBusy = updatingListingId === item.id;
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-2.5 py-2">
                            {!tracked ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => setListingStatus(item, 'saved')}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50"
                                >
                                  <BookmarkPlus className="h-3.5 w-3.5" />
                                  {isBusy ? 'Speichere...' : 'Wohnung merken'}
                                </button>
                                <select
                                  aria-label="Bearbeitungsstand setzen"
                                  value=""
                                  disabled={isBusy}
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      setListingStatus(item, e.target.value as ApplicationStatus);
                                    }
                                  }}
                                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                                >
                                  <option value="" disabled>
                                    Stand markieren...
                                  </option>
                                  {APP_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              <>
                                <span className="text-[11px] font-semibold text-sky-300">
                                  Mein Stand:
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <select
                                    aria-label="Bearbeitungsstand ändern"
                                    value={tracked.application_status}
                                    disabled={isBusy}
                                    onChange={(e) =>
                                      setListingStatus(
                                        item,
                                        e.target.value as ApplicationStatus,
                                        tracked
                                      )
                                    }
                                    className="rounded-lg border border-sky-500/40 bg-slate-900 px-2 py-1 text-xs font-semibold text-sky-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
                                  >
                                    {APP_STATUS_OPTIONS.map((opt) => (
                                      <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => removeListingStatus(item, tracked)}
                                    title="Aus Merkliste / Status entfernen"
                                    className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setSelectedListing(item)}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20"
                        >
                          <ShieldCheck className="h-4 w-4" />
                          Bewerbung &amp; Anschreiben
                        </button>

                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                        >
                          Zur Originalanzeige
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"
            >
              Zurück
            </button>
            <span className="text-xs text-slate-400">
              Seite {page} von {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-slate-200 disabled:opacity-40"
            >
              Weiter
            </button>
          </div>
        )}

        {/* Legal & Info Footer */}
        <footer className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 text-xs text-slate-400">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <div className="space-y-1.5 leading-relaxed">
              <p className="font-semibold text-slate-200">
                Hinweis zu KdU-Richtwerten, Produkttheorie &amp; Direktabtretung
              </p>
              <p>
                Alle angezeigten Werte dienen als Orientierung auf Basis der aktuellen
                KdU-Angemessenheitsgrenzen. Maßgeblich für die Zusicherung ist immer die
                schriftliche Prüfung durch das zuständige Jobcenter bzw. Sozialamt vor
                Mietvertragsunterschrift. Heizkosten werden separat nach tatsächlicher Angemessenheit
                übernommen.
              </p>
              <p className="text-slate-500">
                Rechtlicher Hinweis: Diese Plattform speichert und veröffentlicht keine fremden
                Inseratsbilder oder Volltexte, sondern verweist per Direktlink ausschließlich auf die
                jeweiligen Originalangebote.
              </p>
            </div>
          </div>
        </footer>
          </>
        )}
      </main>

      {selectedListing && (
        <ApplicationModal
          listing={selectedListing}
          rule={activeRule}
          bgSize={bgSize}
          benefitType={benefitType}
          user={user}
          existingApplication={applicationsByListingId.get(selectedListing.id) || null}
          onTracked={fetchApplications}
          onOpenUserArea={() => setActiveView('account')}
          onClose={() => setSelectedListing(null)}
        />
      )}

      {authModalOpen && (
        <AuthModal
          initialMode={authModalMode}
          cities={cities}
          onSuccess={handleAuthSuccess}
          onClose={() => setAuthModalOpen(false)}
        />
      )}
    </div>
  );
}

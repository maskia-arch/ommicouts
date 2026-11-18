'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookmarkPlus,
  Building2,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Filter,
  Flag,
  Home,
  Info,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Minus,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type {
  ApplicationStatus,
  HiddenListingItem,
  KduRule,
  ListingItem,
  ListingsResponse,
  UserApplication,
  UserNotification,
  UserProfile,
} from '@/types/immo';
import { ApplicationModal } from './ApplicationModal';
import { AuthModal } from './AuthModal';
import { DistrictMultiSelect, type DistrictOption } from './DistrictMultiSelect';
import OrganizationListView from './OrganizationListView';
import ReportListingModal from './ReportListingModal';
import { UserAreaView } from './UserAreaView';

const APP_STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'saved', label: 'Vorgemerkt' },
  { value: 'contacted', label: 'Kontaktiert' },
  { value: 'viewing', label: 'Besichtigung' },
  { value: 'accepted', label: 'Zusage' },
  { value: 'rejected', label: 'Absage' },
];

const GELSENKIRCHEN_DISTRICT_MENU: Array<{ name: string; zip: string }> = [
  { name: 'Altstadt', zip: '45879' },
  { name: 'Neustadt', zip: '45879' },
  { name: 'Schalke', zip: '45881' },
  { name: 'Schalke-Nord', zip: '45881' },
  { name: 'Feldmark', zip: '45883' },
  { name: 'Heßler', zip: '45883' },
  { name: 'Rotthausen', zip: '45884' },
  { name: 'Ückendorf', zip: '45886' },
  { name: 'Bulmke-Hüllen', zip: '45888' },
  { name: 'Bismarck', zip: '45889' },
  { name: 'Erle', zip: '45891' },
  { name: 'Resse', zip: '45892' },
  { name: 'Resser Mark', zip: '45892' },
  { name: 'Buer', zip: '45894' },
  { name: 'Scholven', zip: '45896' },
  { name: 'Hassel', zip: '45896/97' },
  { name: 'Buer-Nord', zip: '45897' },
  { name: 'Horst', zip: '45896/99' },
  { name: 'Beckhausen', zip: '45899' },
];

function formatEur(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '–';
  return `${Number(val).toFixed(2).replace('.', ',')} €`;
}

export function formatPortal(
  portal: ListingItem['portal'] | string,
  item?: { url?: string | null; external_id?: string | null } | null
): string {
  if (item) {
    const url = String(item.url || '').toLowerCase();
    const ext = String(item.external_id || '').toLowerCase();
    if (ext.startsWith('ggw_') || url.includes('ggw-gelsenkirchen.de')) {
      return 'GGW Gelsenkirchen';
    }
    if (ext.startsWith('om_') || url.includes('ohne-makler.net')) {
      return 'Ohne-Makler.net';
    }
    if (ext.startsWith('ge_aushang_') || url.includes('wohnungsaushang')) {
      return 'Wohnungsaushang Gelsenkirchen';
    }
    if (ext.startsWith('ms_') || url.includes('mietsofort.de')) {
      return 'MietSofort';
    }
    if (ext.startsWith('rt_') || url.includes('rentola.de')) {
      return 'Rentola';
    }
    if (ext.startsWith('qk_') || url.includes('quoka.de')) {
      return 'Quoka';
    }
    if (url.includes('meinestadt.de')) {
      return 'Meinestadt';
    }
  }
  switch (portal) {
    case 'kleinanzeigen':
      return 'Kleinanzeigen';
    case 'immowelt':
      return 'Immowelt';
    case 'immoscout':
      return 'ImmoScout24';
    case 'ggw':
      return 'GGW Gelsenkirchen';
    default:
      return 'Direktanbieter';
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
  const [minRooms, setMinRooms] = useState<number>(0);
  const [minSqm, setMinSqm] = useState<number>(0);
  const [privateOnly, setPrivateOnly] = useState<boolean>(false);
  const [includeTolerance, setIncludeTolerance] = useState<boolean>(false);
  const [district, setDistrict] = useState<string>('all');
  const [wbs, setWbs] = useState<'all' | 'without' | 'only'>('all');
  const [sort, setSort] = useState<'newest' | 'cheapest' | 'largest'>('newest');
  const [page, setPage] = useState<number>(1);

  const [data, setData] = useState<ListingsResponse | null>(initialData);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingItem | null>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoaded, setAuthLoaded] = useState<boolean>(false);
  const [applications, setApplications] = useState<UserApplication[]>([]);
  const [hiddenListings, setHiddenListings] = useState<HiddenListingItem[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState<number>(0);
  const [reportingListing, setReportingListing] = useState<ListingItem | null>(null);
  const [openOrgSignal, setOpenOrgSignal] = useState<number>(0);
  const [openInboxSignal, setOpenInboxSignal] = useState<number>(0);
  const [hideToast, setHideToast] = useState<{ listingId: string; title: string } | null>(null);
  const [hiddenModalOpen, setHiddenModalOpen] = useState<boolean>(false);
  const [unhidingId, setUnhidingId] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');
  const [activeView, setActiveView] = useState<'search' | 'account' | 'org'>('search');
  const [mobileFilterOpen, setMobileFilterOpen] = useState<boolean>(false);

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

  const fetchHiddenListings = useCallback(async () => {
    try {
      const res = await fetch('/api/me/hidden-listings', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) {
        setHiddenListings([]);
        return;
      }
      const json = await res.json();
      setHiddenListings(Array.isArray(json.hiddenListings) ? json.hiddenListings : []);
    } catch {
      setHiddenListings([]);
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/me/notifications', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) {
        setNotifications([]);
        setUnreadNotificationsCount(0);
        return;
      }
      const json = await res.json();
      setNotifications(Array.isArray(json.notifications) ? json.notifications : []);
      setUnreadNotificationsCount(Number(json.unread_count ?? 0));
    } catch {
      setNotifications([]);
      setUnreadNotificationsCount(0);
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
        await Promise.all([fetchApplications(), fetchHiddenListings(), fetchNotifications()]);
      } else {
        setUser(null);
        setApplications([]);
        setHiddenListings([]);
        setNotifications([]);
        setUnreadNotificationsCount(0);
      }
    } catch {
      setUser(null);
      setApplications([]);
      setHiddenListings([]);
      setNotifications([]);
      setUnreadNotificationsCount(0);
    } finally {
      setAuthLoaded(true);
    }
  }, [fetchApplications, fetchHiddenListings, fetchNotifications]);

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
    await Promise.all([fetchApplications(), fetchHiddenListings(), fetchNotifications()]);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    setUser(null);
    setApplications([]);
    setHiddenListings([]);
    setNotifications([]);
    setUnreadNotificationsCount(0);
    setHideToast(null);
    setHiddenModalOpen(false);
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

  const hideListing = async (item: ListingItem) => {
    if (!user) return;
    setUpdatingListingId(item.id);
    try {
      const res = await fetch('/api/me/hidden-listings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ listing_id: item.id }),
      });
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                total: Math.max(0, prev.total - 1),
                items: prev.items.filter((x) => x.id !== item.id),
              }
            : prev
        );
        setHideToast({ listingId: item.id, title: item.title });
        await fetchHiddenListings();
      }
    } catch {
      // ignore transient error
    } finally {
      setUpdatingListingId(null);
    }
  };

  const unhideListing = async (listingId: string) => {
    if (!user) return;
    setUnhidingId(listingId);
    try {
      const res = await fetch(`/api/me/hidden-listings/${listingId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        if (hideToast?.listingId === listingId) {
          setHideToast(null);
        }
        await Promise.all([fetchHiddenListings(), fetchListings()]);
      }
    } catch {
      // ignore transient error
    } finally {
      setUnhidingId(null);
    }
  };

  const unhideAllListings = async () => {
    if (!user || hiddenListings.length === 0) return;
    setUnhidingId('__all__');
    try {
      await Promise.all(
        hiddenListings.map((h) =>
          fetch(`/api/me/hidden-listings/${h.listing_id}`, {
            method: 'DELETE',
            credentials: 'include',
          })
        )
      );
      setHideToast(null);
      setHiddenModalOpen(false);
      await Promise.all([fetchHiddenListings(), fetchListings()]);
    } catch {
      // ignore
    } finally {
      setUnhidingId(null);
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
      if (minRooms > 0) params.append('min_rooms', String(minRooms));
      if (minSqm > 0) params.append('min_sqm', String(minSqm));

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
  }, [city, bgSize, benefitType, privateOnly, includeTolerance, district, wbs, sort, minRooms, minSqm, page]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const userId = user?.id || null;
  useEffect(() => {
    if (!authLoaded) return;
    fetchListings();
  }, [authLoaded, userId, fetchListings]);

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

  const districtOptions: DistrictOption[] = (
    city.toLowerCase() === 'gelsenkirchen'
      ? (() => {
          const knownNames = new Set(GELSENKIRCHEN_DISTRICT_MENU.map((x) => x.name));
          const extra = (data?.districts || [])
            .filter((d) => d && d !== 'Gelsenkirchen' && !knownNames.has(d))
            .map((d) => ({ name: d, zip: '' }));
          return [...GELSENKIRCHEN_DISTRICT_MENU, ...extra];
        })()
      : (data?.districts || [])
          .filter((d) => d && d.toLowerCase() !== city.toLowerCase())
          .map((d) => ({ name: d, zip: '' }))
  );

  const selectedDistrictsList = district === 'all' || !district
    ? []
    : district.split(',').map((d) => d.trim()).filter(Boolean);

  const handleDistrictChange = (selected: string[]) => {
    if (selected.length === 0) {
      setDistrict('all');
    } else {
      setDistrict(selected.join(','));
    }
    setPage(1);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Bar - Strictly single row (h-16) */}
      <header className="sticky top-0 z-30 h-16 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30 sm:h-10 sm:w-10">
              <Home className="h-4 w-4 sm:h-5 sm:w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-white sm:text-base md:text-lg">
                  KdU Wohnungs-Matcher
                </span>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30 sm:text-[11px]">
                  {city}
                </span>
              </div>
              <p className="hidden text-xs text-slate-400 sm:block">
                Jobcenter (SGB II) &amp; Sozialamt (SGB XII) · Fokus Privatvermieter
              </p>
            </div>
          </div>

          {/* Desktop Navigation Items (hidden on mobile, handled by bottom navigation) */}
          <div className="hidden lg:flex items-center gap-2">
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
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <User className="h-3.5 w-3.5" />
                  Mein Bereich ({applications.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveView('account');
                    setOpenInboxSignal((n) => n + 1);
                  }}
                  title="News-Inbox öffnen"
                  className={`relative inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                    unreadNotificationsCount > 0
                      ? 'border border-sky-500/50 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
                      : 'border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span>Inbox</span>
                  {unreadNotificationsCount > 0 && (
                    <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>
                {user.account_type === 'organization' && (
                  <button
                    type="button"
                    onClick={() => setActiveView('org')}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      activeView === 'org'
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : user.org_status === 'active'
                          ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                          : 'border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Wohnungsliste (Org)
                  </button>
                )}
                <span className="inline-flex items-center rounded-xl border border-slate-800 bg-slate-900/70 px-2.5 py-2 text-xs text-slate-300 max-w-[150px] truncate">
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  title="Abmelden"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/40 hover:text-rose-200"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Abmelden</span>
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
          </div>

          {/* Mobile Right Controls: Compact Quick Auth Icon / Status */}
          <div className="flex lg:hidden items-center gap-2">
            {!user ? (
              <button
                type="button"
                onClick={() => {
                  setAuthModalMode('login');
                  setAuthModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Login</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogout}
                title="Abmelden"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-slate-400 hover:text-rose-300"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 pb-24 lg:pb-12">
        {user && user.account_type === 'organization' && user.org_status !== 'active' && (
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                <div className="text-sm font-bold text-amber-200">
                  {user.org_status === 'revoked'
                    ? 'Deine Organisations-Lizenz wurde widerrufen'
                    : 'Deine Organisations-Lizenz ist abgelaufen — bitte erneuern'}
                </div>
                <p className="mt-0.5 text-xs text-amber-100/90">
                  {user.org_license_expires_at
                    ? `Gültigkeit endete am ${new Date(user.org_license_expires_at).toLocaleDateString('de-DE')}. `
                    : ''}
                  Aktiviere unter „Organisation anmelden“ einen neuen Key oder lass deinen bestehenden Key verlängern, um weiterhin PDF-Wohnungslisten zu erstellen.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveView('account');
                setOpenOrgSignal((n) => n + 1);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Lizenz jetzt erneuern
            </button>
          </div>
        )}

        {activeView === 'org' && user ? (
          <OrganizationListView
            user={user}
            cities={cities}
            onGoToOrgActivation={() => {
              setActiveView('account');
              setOpenOrgSignal((n) => n + 1);
            }}
          />
        ) : activeView === 'account' && user ? (
          <UserAreaView
            user={user}
            cities={cities}
            applications={applications}
            hiddenListings={hiddenListings}
            notifications={notifications}
            unreadNotificationsCount={unreadNotificationsCount}
            onUserUpdated={(updated) => setUser(updated)}
            onApplicationsChanged={fetchApplications}
            onHiddenListingsChanged={() => {
              fetchHiddenListings();
              fetchListings();
            }}
            onNotificationsChanged={fetchNotifications}
            onBackToSearch={() => setActiveView('search')}
            onGoToOrgList={() => setActiveView('org')}
            openOrgSignal={openOrgSignal}
            openInboxSignal={openInboxSignal}
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

            {/* Mobile Sticky Summary Bar + Filter Trigger (< 1024px) */}
            <div className="sticky top-16 z-20 -mx-4 -mt-2 mb-4 border-y border-slate-800/80 bg-slate-950/95 px-4 py-2.5 backdrop-blur-md lg:hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-hidden text-xs">
                  <span className="font-bold text-white truncate">{city}</span>
                  <span className="text-slate-600">·</span>
                  <span className="font-medium text-emerald-300 whitespace-nowrap">
                    {bgSize} {bgSize === 1 ? 'Pers.' : 'Pers.'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-400 truncate">
                    {district === 'all' || !district
                      ? 'Alle Stadtteile'
                      : district.includes(',')
                        ? `${district.split(',').length} Stadtteile`
                        : district}
                  </span>
                  {privateOnly && (
                    <span className="hidden xs:inline-flex rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                      Privat
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setMobileFilterOpen(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/25 active:scale-95"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span>Filter anpassen</span>
                </button>
              </div>
            </div>

            {/* Main 2-Column Cockpit Grid (lg: 360px sidebar + 1fr content) */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[360px_1fr]">
              {/* Left Column: Sticky Desktop Filter Sidebar */}
              <aside className="hidden lg:block sticky top-20 z-10 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                      Such-Cockpit
                    </h2>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                    {city}
                  </span>
                </div>

                {/* 1. Stadt */}
                <div>
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
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-white focus:border-emerald-500 focus:outline-none"
                  >
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Stadtteil Multi-Select mit Suchfeld */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Stadtteile in {city}
                  </label>
                  <DistrictMultiSelect
                    city={city}
                    options={districtOptions}
                    selectedDistricts={selectedDistrictsList}
                    onChange={handleDistrictChange}
                  />
                </div>

                {/* 3. Leistungsart */}
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Leistungsart
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBenefitType('sgb2')}
                      className={`rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                        benefitType === 'sgb2'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold">Bürgergeld</div>
                      <div className="text-[10px] font-normal text-slate-500">SGB II · Jobcenter</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBenefitType('sgb12')}
                      className={`rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                        benefitType === 'sgb12'
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold">Grundsicherung</div>
                      <div className="text-[10px] font-normal text-slate-500">SGB XII · Sozialamt</div>
                    </button>
                  </div>
                </div>

                {/* 4. Bedarfsgemeinschaft (1–6+) */}
                <div>
                  <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <Users className="h-3.5 w-3.5 text-emerald-400" />
                      Personen im Haushalt
                    </span>
                    <span className="text-emerald-300 font-bold">{bgSize} {bgSize === 1 ? 'Person' : 'Personen'}</span>
                  </label>
                  <div className="grid grid-cols-6 gap-1">
                    {[1, 2, 3, 4, 5, 6].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setBgSize(num);
                          setPage(1);
                        }}
                        className={`h-9 rounded-lg border text-xs font-bold transition ${
                          bgSize === num
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/30'
                            : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {num === 6 && bgSize > 6 ? `${bgSize}` : num === 6 ? '6+' : num}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-400">
                    <span>Größere BG anpassen:</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setBgSize((prev) => Math.max(1, prev - 1));
                          setPage(1);
                        }}
                        aria-label="Person weniger"
                        className="rounded p-1 hover:bg-slate-800 hover:text-white"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="min-w-[20px] text-center font-bold text-white">{bgSize}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setBgSize((prev) => Math.min(12, prev + 1));
                          setPage(1);
                        }}
                        aria-label="Weitere Person"
                        className="rounded p-1 hover:bg-slate-800 hover:text-white"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 4b. Mindestanforderungen (Räume & Wohnfläche) */}
                <div className="space-y-1.5 pt-0.5">
                  <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
                      Mindestgröße
                    </span>
                    {(minRooms > 0 || minSqm > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setMinRooms(0);
                          setMinSqm(0);
                          setPage(1);
                        }}
                        className="text-[10px] font-medium text-slate-400 hover:text-emerald-300"
                      >
                        Zurücksetzen
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Min. Räume
                      </label>
                      <select
                        value={minRooms}
                        onChange={(e) => {
                          setMinRooms(Number(e.target.value));
                          setPage(1);
                        }}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value={0}>Alle Räume</option>
                        <option value={1}>Ab 1 Zi.</option>
                        <option value={1.5}>Ab 1,5 Zi.</option>
                        <option value={2}>Ab 2 Zi.</option>
                        <option value={2.5}>Ab 2,5 Zi.</option>
                        <option value={3}>Ab 3 Zi.</option>
                        <option value={3.5}>Ab 3,5 Zi.</option>
                        <option value={4}>Ab 4 Zi.</option>
                        <option value={5}>Ab 5 Zi.</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Min. qm
                      </label>
                      <select
                        value={minSqm}
                        onChange={(e) => {
                          setMinSqm(Number(e.target.value));
                          setPage(1);
                        }}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value={0}>Beliebig</option>
                        <option value={30}>Ab 30 m²</option>
                        <option value={40}>Ab 40 m²</option>
                        <option value={50}>Ab 50 m²</option>
                        <option value={60}>Ab 60 m²</option>
                        <option value={70}>Ab 70 m²</option>
                        <option value={80}>Ab 80 m²</option>
                        <option value={90}>Ab 90 m²</option>
                        <option value={100}>Ab 100 m²</option>
                      </select>
                    </div>
                  </div>

                  {bgSize > 1 && (
                    <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">
                      💡 Tipp: Für {bgSize} Personen gezielt ab {Math.max(2, Math.floor(bgSize * 0.8))} Zimmer filtern
                    </div>
                  )}
                </div>

                {/* 5. Toggles ("Nur private Vermieter" & "+10 % Toleranz") */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPrivateOnly((v) => !v);
                      setPage(1);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition ${
                      privateOnly
                        ? 'border-amber-400/80 bg-amber-500/15 shadow-sm shadow-amber-500/20'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <UserCheck className={`h-4 w-4 ${privateOnly ? 'text-amber-400' : 'text-slate-400'}`} />
                      <div>
                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                          Nur von Privat
                          <span className="rounded bg-amber-400/20 px-1.5 py-0.2 text-[9px] font-bold text-amber-300">
                            Schufa-Tipp
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400">Direktabtretung oft möglich</div>
                      </div>
                    </div>
                    <div
                      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
                        privateOnly ? 'bg-amber-400' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          privateOnly ? 'translate-x-4' : 'translate-x-0'
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
                    className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition ${
                      includeTolerance
                        ? 'border-sky-400/80 bg-sky-500/15 shadow-sm shadow-sky-500/20'
                        : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className={`h-4 w-4 ${includeTolerance ? 'text-sky-400' : 'text-slate-400'}`} />
                      <div>
                        <div className="text-xs font-bold text-white">+10 % Toleranz</div>
                        <div className="text-[10px] text-slate-400">
                          bis {formatEur(activeRule.max_bruttokalt_eur * 1.1)} BK
                        </div>
                      </div>
                    </div>
                    <div
                      className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
                        includeTolerance ? 'bg-sky-400' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          includeTolerance ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </div>
                  </button>
                </div>

                {/* 6. Kompakte KdU-Obergrenzen-Box */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-100">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    <span>KdU-Limit ({city}, {bgSize} {bgSize === 1 ? 'Pers.' : 'Pers.'}):</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="text-slate-400">Max. Wohnfläche:</span>
                    <span className="font-semibold text-white">{activeRule.max_sqm} m²</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between">
                    <span className="text-slate-400">Bruttokaltmiete:</span>
                    <span className="font-bold text-emerald-300 text-sm">
                      {formatEur(activeRule.max_bruttokalt_eur)}
                    </span>
                  </div>
                  {includeTolerance && data?.tolerance_limit_eur && (
                    <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-sky-300">
                      <span>Mit +10 % Toleranz:</span>
                      <span className="font-semibold">{formatEur(data.tolerance_limit_eur)}</span>
                    </div>
                  )}
                </div>
              </aside>

              {/* Right Column: Search Results Content */}
              <div className="space-y-4 min-w-0">
                {/* Result Control Bar: Count + WBS + Sort + Refresh Icon Button */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:px-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {data ? `${data.total} passende Wohnungen` : 'Suche Wohnungen...'}
                    </span>
                    {data && data.private_count > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                        {data.private_count} von Privat
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={wbs}
                      onChange={(e) => {
                        setWbs(e.target.value as 'all' | 'without' | 'only');
                        setPage(1);
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="all">WBS: Alle</option>
                      <option value="without">Ohne WBS</option>
                      <option value="only">Nur WBS</option>
                    </select>

                    <select
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value as 'newest' | 'cheapest' | 'largest');
                        setPage(1);
                      }}
                      className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="newest">Neueste zuerst</option>
                      <option value="cheapest">Günstigste Bruttokalt</option>
                      <option value="largest">Größte m²</option>
                    </select>

                    <button
                      type="button"
                      onClick={fetchListings}
                      disabled={loading}
                      title="Ergebnisse aktualisieren"
                      aria-label="Ergebnisse aktualisieren"
                      className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-slate-300 transition hover:border-emerald-500/50 hover:bg-slate-800 hover:text-white disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Visible Notice & Undo for Hidden Listings */}
                {user && (hideToast || hiddenListings.length > 0) && (
                  <div className="space-y-2">
                    {hideToast && (
                      <div className="flex flex-col justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-2">
                          <EyeOff className="h-4 w-4 shrink-0 text-amber-300" />
                          <span>
                            Anzeige <strong className="text-white">„{hideToast.title}“</strong> wurde aus deiner Übersicht ausgeblendet.
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            disabled={unhidingId === hideToast.listingId}
                            onClick={() => unhideListing(hideToast.listingId)}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Rückgängig machen
                          </button>
                          <button
                            type="button"
                            onClick={() => setHideToast(null)}
                            aria-label="Hinweis schließen"
                            className="rounded-lg p-1 text-amber-200/80 hover:bg-amber-500/20 hover:text-white"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {hiddenListings.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-2.5 text-xs text-slate-300">
                        <div className="flex items-center gap-2">
                          <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            <strong className="text-white">{hiddenListings.length}</strong>{' '}
                            {hiddenListings.length === 1
                              ? 'Wohnung ist aktuell von dir ausgeblendet'
                              : 'Wohnungen sind aktuell von dir ausgeblendet'}
                            .
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setHiddenModalOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-semibold text-emerald-300 transition hover:border-emerald-500/40 hover:bg-slate-700"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ausgeblendete verwalten / wieder einblenden
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/30 p-4 text-sm text-rose-200">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-rose-400" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Results Grid - Responsive 2-Col on Desktop, 1-Col on Mobile */}
                {!loading && data && data.items.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
                    <Building2 className="mx-auto h-10 w-10 text-slate-600" />
                    <h2 className="mt-3 text-base font-bold text-white">
                      Aktuell keine passenden Inserate für diese Filter
                    </h2>
                    <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
                      Tipp: Aktiviere die +10 % Eigenanteil-Toleranz oder wähle weitere Stadtteile
                      aus. Der Crawler prüft alle 20 Minuten automatisch auf neue Angebote.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {(data?.items || [])
                      .filter(
                        (item) =>
                          !item.url?.includes('mietsofort.de') &&
                          !item.external_id?.startsWith('ms_')
                      )
                      .map((item) => (
              <article
                key={item.id}
                className="flex h-full flex-col justify-between rounded-2xl border border-slate-800 bg-slate-900/80 p-4 transition hover:border-slate-700 sm:p-5"
              >
                <div className="flex flex-1 flex-col">
                  {/* Badges (standard single/compact row height) */}
                  <div className="mb-2.5 flex min-h-[28px] flex-wrap items-center gap-1.5">
                    {item.compliance_status === 'tolerance' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                        <AlertTriangle className="h-3 w-3" />
                        Eigenanteil +{formatEur(item.eigenanteil_eur)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/30">
                        <CheckCircle2 className="h-3 w-3" />
                        {item.compliance_status === 'produkttheorie'
                          ? 'KdU-Konform (Produkttheorie)'
                          : '100% Jobcenter-Konform'}
                      </span>
                    )}

                    {item.is_private_landlord && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-300 ring-1 ring-sky-500/40">
                        <UserCheck className="h-3 w-3" />
                        Privatvermieter
                      </span>
                    )}

                    {item.wbs_required && (
                      <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-semibold text-purple-300 ring-1 ring-purple-500/30">
                        WBS
                      </span>
                    )}

                    <span className="ml-auto text-[11px] font-medium text-slate-500">
                      {formatPortal(item.portal, item)} · {formatRelativeDate(item.first_seen_at)}
                    </span>
                  </div>

                  {/* Title (fixed 2-line slot so all cards align horizontally) */}
                  <h2 className="min-h-[2.75rem] line-clamp-2 text-base font-bold leading-snug text-white">
                    {item.title}
                  </h2>

                  {/* Location & Specs (fixed row height) */}
                  <div className="mt-2 flex min-h-[26px] flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1 font-medium text-slate-300">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate max-w-[230px]">
                        {item.zipcode ? `${item.zipcode} ` : ''}
                        {item.city}
                        {item.district && item.district !== item.city ? ` – ${item.district}` : ''}
                      </span>
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

                  {/* Standardized Contact / Provider Slot directly below Title & Specs */}
                  {user ? (
                    item.contact_phone || item.contact_email || item.contact_name ? (
                      <div className="mt-3 flex h-[56px] flex-col justify-center gap-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs">
                        <div className="truncate font-medium text-slate-200" title={item.contact_name || ''}>
                          {item.contact_name || `Anbieter (${formatPortal(item.portal, item)})`}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 truncate">
                          {item.contact_phone && (
                            <a
                              href={`tel:${item.contact_phone}`}
                              className="inline-flex items-center gap-1 font-semibold text-emerald-300 hover:underline"
                            >
                              <Phone className="h-3 w-3 shrink-0" />
                              {item.contact_phone}
                            </a>
                          )}
                          {item.contact_email && (
                            <a
                              href={`mailto:${item.contact_email}`}
                              className="inline-flex items-center gap-1 truncate font-semibold text-sky-300 hover:underline"
                            >
                              <Mail className="h-3 w-3 shrink-0" />
                              {item.contact_email}
                            </a>
                          )}
                          {!item.contact_phone && !item.contact_email && (
                            <span className="text-[11px] text-slate-400">
                              Kontakt über Originalanzeige ({formatPortal(item.portal, item)})
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex h-[56px] flex-col justify-center gap-0.5 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
                        <div className="truncate font-medium text-slate-300">
                          Anbieter über {formatPortal(item.portal, item)}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          Keine direkte Telefonnummer hinterlegt · Anfrage über Originalanzeige
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="mt-3 flex h-[56px] items-center gap-2 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-xs text-slate-500">
                      <Lock className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">
                        Direkte Anbieter- &amp; Kontaktdaten nach Login sichtbar
                      </span>
                    </div>
                  )}

                  {/* Rent Breakdown (uniform height + anchored cleanly at bottom of upper block) */}
                  <div className="mt-auto pt-3">
                    <div className="flex min-h-[76px] items-center rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                      <div className="flex w-full flex-wrap items-baseline justify-between gap-2">
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
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {item.heating_costs > 0
                              ? `+ Heizkosten (separat): ${formatEur(item.heating_costs)}`
                              : 'Heizkosten: separat / laut Inserat'}
                          </div>
                        </div>
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
                        className="inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5 text-xs font-semibold text-slate-500 opacity-75"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Bewerbungstext (Login nötig)
                      </button>

                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        title="Bitte zuerst anmelden, um zur Originalanzeige zu gelangen"
                        className="inline-flex min-h-[44px] cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5 text-xs font-semibold text-slate-500 opacity-75"
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
                                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-200 transition hover:bg-sky-500/20 disabled:opacity-50"
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
                                  className="min-h-[36px] rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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
                                    className="min-h-[36px] rounded-lg border border-sky-500/40 bg-slate-900 px-2 py-1 text-xs font-semibold text-sky-200 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
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
                                    className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}

                      {(() => {
                        const isWohnungsaushang =
                          item.external_id?.startsWith('ge_aushang_') ||
                          String(item.url || '').includes('wohnungsaushang');
                        const targetUrl = isWohnungsaushang
                          ? `/api/wohnungsaushang/view?id=${encodeURIComponent(item.external_id)}`
                          : item.url;
                        const buttonText = isWohnungsaushang
                          ? 'Zum Wohnungsaushang'
                          : 'Zur Originalanzeige';

                        return (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => setSelectedListing(item)}
                              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3.5 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/20 active:scale-[0.99]"
                            >
                              <ShieldCheck className="h-4 w-4 shrink-0" />
                              <span>Bewerbung &amp; Anschreiben</span>
                            </button>

                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99]"
                            >
                              <span>{buttonText}</span>
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            </a>
                          </div>
                        );
                      })()}

                      <div className="flex items-center justify-end gap-2 pt-0.5 text-[11px]">
                        <button
                          type="button"
                          disabled={updatingListingId === item.id}
                          onClick={() => hideListing(item)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
                          title="Anzeige aus meiner Übersicht ausblenden"
                        >
                          <EyeOff className="h-3 w-3" />
                          Ausblenden
                        </button>
                        <button
                          type="button"
                          onClick={() => setReportingListing(item)}
                          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
                          title="Anzeige wegen Mängeln oder Ablehnung von Jobcenter melden"
                        >
                          <Flag className="h-3 w-3" />
                          Anzeige melden
                        </button>
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
              </div>
            </div>

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

      {reportingListing && (
        <ReportListingModal
          listing={reportingListing}
          onClose={() => setReportingListing(null)}
          onSubmitted={(listingId, alsoHidden) => {
            if (alsoHidden) {
              setData((prev) =>
                prev
                  ? {
                      ...prev,
                      total: Math.max(0, prev.total - 1),
                      items: prev.items.filter((x) => x.id !== listingId),
                    }
                  : prev
              );
              setHideToast({ listingId, title: reportingListing.title });
              fetchHiddenListings();
            }
          }}
        />
      )}

      {hiddenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <EyeOff className="h-5 w-5 text-amber-400" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    Ausgeblendete Wohnungen ({hiddenListings.length})
                  </h2>
                  <p className="text-xs text-slate-400">
                    Hier kannst du jederzeit einzelne oder alle ausgeblendeten Inserate wieder sichtbar machen.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setHiddenModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto p-5">
              {hiddenListings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                  Aktuell sind keine Wohnungen ausgeblendet.
                </div>
              ) : (
                hiddenListings.map((h) => (
                  <div
                    key={h.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-white">{h.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>
                          {h.zipcode ? `${h.zipcode} ` : ''}
                          {h.city}
                          {h.district ? ` · ${h.district}` : ''}
                        </span>
                        <span>·</span>
                        <span className="font-semibold text-emerald-300">
                          {formatEur(h.calculated_bruttokalt)}
                        </span>
                        {h.sqm && <span>· {h.sqm} m²</span>}
                        {h.rooms && <span>· {h.rooms} Zi.</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                      >
                        Inserat
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        disabled={unhidingId === h.listing_id || unhidingId === '__all__'}
                        onClick={() => unhideListing(h.listing_id)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Wieder einblenden
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-5 py-3.5">
              {hiddenListings.length > 1 ? (
                <button
                  type="button"
                  disabled={unhidingId === '__all__'}
                  onClick={unhideAllListings}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Alle {hiddenListings.length} wieder einblenden
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setHiddenModalOpen(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom-Sheet / Slide-Up Drawer for Filters (< 1024px) */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileFilterOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Container */}
          <div className="relative z-10 flex max-h-[88vh] w-full flex-col rounded-t-3xl border-t border-slate-700 bg-slate-900 shadow-2xl animate-in slide-in-from-bottom duration-200">
            {/* Drawer Header */}
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                  Filter anpassen
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMobileFilterOpen(false)}
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Filter schließen"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Scrollable Body */}
            <div className="space-y-4 overflow-y-auto p-5 pb-6">
              {/* 1. Stadt */}
              <div>
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
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-medium text-white focus:border-emerald-500 focus:outline-none"
                >
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* 2. Stadtteile Multi-Select */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Stadtteile in {city}
                </label>
                <DistrictMultiSelect
                  city={city}
                  options={districtOptions}
                  selectedDistricts={selectedDistrictsList}
                  onChange={handleDistrictChange}
                />
              </div>

              {/* 3. Leistungsart */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Leistungsart
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBenefitType('sgb2')}
                    className={`rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                      benefitType === 'sgb2'
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold">Bürgergeld</div>
                    <div className="text-[10px] font-normal text-slate-500">SGB II · Jobcenter</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBenefitType('sgb12')}
                    className={`rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                      benefitType === 'sgb12'
                        ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold">Grundsicherung</div>
                    <div className="text-[10px] font-normal text-slate-500">SGB XII · Sozialamt</div>
                  </button>
                </div>
              </div>

              {/* 4. Bedarfsgemeinschaft (1–6+) */}
              <div>
                <label className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-emerald-400" />
                    Personen im Haushalt
                  </span>
                  <span className="text-emerald-300 font-bold">{bgSize} {bgSize === 1 ? 'Person' : 'Personen'}</span>
                </label>
                <div className="grid grid-cols-6 gap-1">
                  {[1, 2, 3, 4, 5, 6].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setBgSize(num);
                        setPage(1);
                      }}
                      className={`h-10 rounded-lg border text-xs font-bold transition ${
                        bgSize === num
                          ? 'border-emerald-500 bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/30'
                          : 'border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      {num === 6 && bgSize > 6 ? `${bgSize}` : num === 6 ? '6+' : num}
                    </button>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-slate-400">
                  <span>Größere BG anpassen:</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setBgSize((prev) => Math.max(1, prev - 1));
                        setPage(1);
                      }}
                      aria-label="Person weniger"
                      className="rounded p-1 hover:bg-slate-800 hover:text-white"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-[20px] text-center font-bold text-white">{bgSize}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setBgSize((prev) => Math.min(12, prev + 1));
                        setPage(1);
                      }}
                      aria-label="Weitere Person"
                      className="rounded p-1 hover:bg-slate-800 hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* 4b. Mindestanforderungen (Räume & Wohnfläche) */}
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-emerald-400" />
                    Mindestgröße
                  </span>
                  {(minRooms > 0 || minSqm > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setMinRooms(0);
                        setMinSqm(0);
                        setPage(1);
                      }}
                      className="text-[10px] font-medium text-slate-400 hover:text-emerald-300"
                    >
                      Zurücksetzen
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Min. Räume
                    </label>
                    <select
                      value={minRooms}
                      onChange={(e) => {
                        setMinRooms(Number(e.target.value));
                        setPage(1);
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value={0}>Alle Räume</option>
                      <option value={1}>Ab 1 Zi.</option>
                      <option value={1.5}>Ab 1,5 Zi.</option>
                      <option value={2}>Ab 2 Zi.</option>
                      <option value={2.5}>Ab 2,5 Zi.</option>
                      <option value={3}>Ab 3 Zi.</option>
                      <option value={3.5}>Ab 3,5 Zi.</option>
                      <option value={4}>Ab 4 Zi.</option>
                      <option value={5}>Ab 5 Zi.</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Min. qm
                    </label>
                    <select
                      value={minSqm}
                      onChange={(e) => {
                        setMinSqm(Number(e.target.value));
                        setPage(1);
                      }}
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value={0}>Beliebig</option>
                      <option value={30}>Ab 30 m²</option>
                      <option value={40}>Ab 40 m²</option>
                      <option value={50}>Ab 50 m²</option>
                      <option value={60}>Ab 60 m²</option>
                      <option value={70}>Ab 70 m²</option>
                      <option value={80}>Ab 80 m²</option>
                      <option value={90}>Ab 90 m²</option>
                      <option value={100}>Ab 100 m²</option>
                    </select>
                  </div>
                </div>

                {bgSize > 1 && (
                  <div className="rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300">
                    💡 Tipp: Für {bgSize} Personen gezielt ab {Math.max(2, Math.floor(bgSize * 0.8))} Zimmer filtern
                  </div>
                )}
              </div>

              {/* 5. Toggles */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPrivateOnly((v) => !v);
                    setPage(1);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                    privateOnly
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck
                      className={`h-4 w-4 shrink-0 ${
                        privateOnly ? 'text-amber-400' : 'text-slate-500'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold">Nur private Vermieter</div>
                      <div className="text-[11px] text-slate-400">
                        Schließt Vonovia, LEG &amp; Großkonzerne aus
                      </div>
                    </div>
                  </div>
                  <div
                    className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
                      privateOnly ? 'bg-amber-400' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-full bg-slate-950 transition-transform ${
                        privateOnly ? 'translate-x-4' : 'translate-x-0'
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
                  className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${
                    includeTolerance
                      ? 'border-sky-500/50 bg-sky-500/10 text-sky-200'
                      : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Sparkles
                      className={`h-4 w-4 shrink-0 ${
                        includeTolerance ? 'text-sky-400' : 'text-slate-500'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold">+10 % Toleranz (Eigenanteil)</div>
                      <div className="text-[11px] text-slate-400">
                        Zeigt Angebote bis zu 10 % über KdU
                      </div>
                    </div>
                  </div>
                  <div
                    className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
                      includeTolerance ? 'bg-sky-400' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`h-4 w-4 rounded-full bg-white transition-transform ${
                        includeTolerance ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>

              {/* 6. KdU-Limit Box */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs text-emerald-100">
                <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>KdU-Limit ({city}, {bgSize} {bgSize === 1 ? 'Pers.' : 'Pers.'}):</span>
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-slate-400">Max. Wohnfläche:</span>
                  <span className="font-semibold text-white">{activeRule.max_sqm} m²</span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between">
                  <span className="text-slate-400">Bruttokaltmiete:</span>
                  <span className="font-bold text-emerald-300 text-sm">
                    {formatEur(activeRule.max_bruttokalt_eur)}
                  </span>
                </div>
                {includeTolerance && data?.tolerance_limit_eur && (
                  <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-sky-300">
                    <span>Mit +10 % Toleranz:</span>
                    <span className="font-semibold">{formatEur(data.tolerance_limit_eur)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Sticky Footer Action Button */}
            <div className="border-t border-slate-800 bg-slate-900/95 p-4 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setMobileFilterOpen(false)}
                className="w-full min-h-[44px] rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 transition active:scale-[0.98]"
              >
                {data ? `${data.total} passende Wohnungen anzeigen` : 'Treffer anzeigen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (< 1024px) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-slate-800/90 bg-slate-950/95 px-2 backdrop-blur-lg lg:hidden">
        <button
          type="button"
          onClick={() => {
            setActiveView('search');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className={`flex min-h-[44px] flex-1 flex-col items-center justify-center py-1 text-center transition ${
            activeView === 'search' ? 'text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] tracking-tight">Wohnungssuche</span>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!user) {
              setAuthModalMode('login');
              setAuthModalOpen(true);
            } else {
              setActiveView('account');
            }
          }}
          className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center py-1 text-center transition ${
            activeView === 'account' ? 'text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] tracking-tight">Mein Bereich</span>
          {user && applications.length > 0 && (
            <span className="absolute top-1 right-[20%] inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-slate-950">
              {applications.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!user) {
              setAuthModalMode('login');
              setAuthModalOpen(true);
            } else {
              setActiveView('account');
              setOpenInboxSignal((n) => n + 1);
            }
          }}
          className="relative flex min-h-[44px] flex-1 flex-col items-center justify-center py-1 text-center text-slate-400 transition hover:text-slate-200"
        >
          <Bell className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] tracking-tight">Inbox</span>
          {unreadNotificationsCount > 0 && (
            <span className="absolute top-1 right-[20%] inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white animate-pulse">
              {unreadNotificationsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            if (!user) {
              setAuthModalMode('login');
              setAuthModalOpen(true);
            } else {
              setActiveView('account');
            }
          }}
          className={`flex min-h-[44px] flex-1 flex-col items-center justify-center py-1 text-center transition ${
            user && activeView === 'account' ? 'text-emerald-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <User className="h-5 w-5" />
          <span className="mt-0.5 text-[10px] tracking-tight">{user ? 'Profil' : 'Anmelden'}</span>
        </button>
      </nav>
    </div>
  );
}

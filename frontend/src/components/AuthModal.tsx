'use client';

import React, { useState } from 'react';
import { Lock, LogIn, UserPlus, X } from 'lucide-react';
import type { UserProfile } from '@/types/immo';

interface AuthModalProps {
  initialMode?: 'login' | 'register';
  cities: string[];
  onSuccess: (user: UserProfile) => void;
  onClose: () => void;
}

export function AuthModal({
  initialMode = 'login',
  cities,
  onSuccess,
  onClose,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [preferredCity, setPreferredCity] = useState(cities[0] || 'Gelsenkirchen');
  const [bgSize, setBgSize] = useState(1);
  const [benefitType, setBenefitType] = useState<'sgb2' | 'sgb12'>('sgb2');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : {
              email,
              password,
              full_name: fullName,
              phone,
              preferred_city: preferredCity,
              bg_size: bgSize,
              benefit_type: benefitType,
            };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Anmeldung fehlgeschlagen.');
      }
      onSuccess(json.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verbindungsfehler');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {mode === 'login' ? 'Anmelden' : 'Kostenloses Konto erstellen'}
              </h2>
              <p className="text-xs text-slate-400">
                Für Vermieter-Kontakt, Merkliste &amp; Portal-Status
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            aria-label="Modal schließen"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="mb-4 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                mode === 'login'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <LogIn className="h-3.5 w-3.5" />
              Anmelden
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition ${
                mode === 'register'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              Registrieren
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-300">
                  Vor- und Nachname *
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="z.B. Max Mustermann"
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                E-Mail-Adresse *
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Passwort {mode === 'register' ? '(mind. 8 Zeichen) *' : '*'}
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            {mode === 'register' && (
              <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Telefon (optional)
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0176 ..."
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Stadt
                  </label>
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
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Personen (BG)
                  </label>
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
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Leistung
                  </label>
                  <select
                    value={benefitType}
                    onChange={(e) => setBenefitType(e.target.value === 'sgb12' ? 'sgb12' : 'sgb2')}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="sgb2">Bürgergeld (SGB II)</option>
                    <option value="sgb12">Sozialhilfe (SGB XII)</option>
                  </select>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting
                ? 'Bitte warten...'
                : mode === 'login'
                  ? 'Jetzt anmelden'
                  : 'Konto anlegen & anmelden'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

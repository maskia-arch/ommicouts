'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, MapPin, Search, X } from 'lucide-react';

export interface DistrictOption {
  name: string;
  zip?: string;
}

interface DistrictMultiSelectProps {
  city: string;
  options: DistrictOption[];
  selectedDistricts: string[]; // empty array = "all"
  onChange: (selected: string[]) => void;
}

export function DistrictMultiSelect({
  city,
  options,
  selectedDistricts,
  onChange,
}: DistrictMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const filteredOptions = options.filter((opt) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      opt.name.toLowerCase().includes(q) ||
      (opt.zip && opt.zip.toLowerCase().includes(q))
    );
  });

  const isAll = selectedDistricts.length === 0;

  const toggleDistrict = (name: string) => {
    const isSelected = selectedDistricts.includes(name);
    if (isSelected) {
      onChange(selectedDistricts.filter((d) => d !== name));
    } else {
      onChange([...selectedDistricts, name]);
    }
  };

  const removeDistrict = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(selectedDistricts.filter((d) => d !== name));
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <div ref={containerRef} className="relative w-full text-xs">
      {/* Dropdown Toggle Header */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-h-[42px] w-full items-center justify-between gap-2 rounded-xl border border-slate-700/80 bg-slate-950 px-3 py-2 text-left transition hover:border-slate-600 focus:border-emerald-500 focus:outline-none"
      >
        <div className="flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          {isAll ? (
            <span className="font-medium text-slate-300">
              Alle Stadtteile ({city})
            </span>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {selectedDistricts.map((d) => {
                const opt = options.find((o) => o.name.toLowerCase() === d.toLowerCase());
                return (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40"
                  >
                    <span>{d}</span>
                    {opt?.zip && (
                      <span className="text-[10px] text-emerald-400/80 font-normal">
                        {opt.zip}
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => removeDistrict(d, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onChange(selectedDistricts.filter((x) => x !== d));
                        }
                      }}
                      className="ml-0.5 rounded p-0.5 text-emerald-300 hover:bg-emerald-500/30 hover:text-white"
                      title={`${d} abwählen`}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 text-slate-400">
          {!isAll && (
            <span
              role="button"
              tabIndex={0}
              onClick={clearAll}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange([]);
                }
              }}
              title="Alle abwählen"
              className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              open ? 'rotate-180 text-emerald-400' : ''
            }`}
          />
        </div>
      </button>

      {/* Popover / Dropdown Menu */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-72 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl ring-1 ring-black/50">
          {/* Search Box */}
          <div className="border-b border-slate-800 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Stadtteil oder PLZ suchen..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-1.5 text-[11px] text-slate-400">
            <button
              type="button"
              onClick={() => onChange([])}
              className={`hover:text-emerald-300 ${
                isAll ? 'font-bold text-emerald-400' : ''
              }`}
            >
              Alle auswählen ({options.length})
            </button>
            {!isAll && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-slate-400 hover:text-rose-300"
              >
                Zurücksetzen
              </button>
            )}
          </div>

          {/* Options List */}
          <div className="max-h-52 overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-center text-xs text-slate-500">
                Kein Stadtteil gefunden
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selectedDistricts.includes(opt.name);
                return (
                  <button
                    key={opt.name}
                    type="button"
                    onClick={() => toggleDistrict(opt.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      checked
                        ? 'bg-emerald-500/15 text-emerald-200 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? 'border-emerald-500 bg-emerald-500 text-slate-950'
                            : 'border-slate-700 bg-slate-950'
                        }`}
                      >
                        {checked && <Check className="h-3 w-3 stroke-[3]" />}
                      </div>
                      <span>{opt.name}</span>
                    </div>
                    {opt.zip && (
                      <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {opt.zip}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

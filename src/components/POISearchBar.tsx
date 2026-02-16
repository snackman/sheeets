'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MapPin, BedDouble, Utensils, Wine, Laptop, Users,
  Search, X, Plus, Loader2, Check,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGeocoder } from '@/hooks/useGeocoder';
import { POI_CATEGORIES } from '@/lib/constants';
import type { POICategory } from '@/lib/types';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  MapPin,
  BedDouble,
  Utensils,
  Wine,
  Laptop,
  Users,
};

interface POISearchBarProps {
  onAddPOI?: (poi: {
    name: string;
    lat: number;
    lng: number;
    address?: string | null;
    category: POICategory;
    note?: string | null;
  }) => Promise<unknown>;
}

export function POISearchBar({ onAddPOI }: POISearchBarProps) {
  const { user } = useAuth();
  const { query, search, results, loading, clear } = useGeocoder();

  const [expanded, setExpanded] = useState(false);
  const [selectedResult, setSelectedResult] = useState<{
    text: string;
    place_name: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [category, setCategory] = useState<POICategory>('pin');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus input when expanded
  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    if (expanded) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    setExpanded(false);
    setSelectedResult(null);
    setCategory('pin');
    setName('');
    clear();
  }, [clear]);

  const handleSelectResult = useCallback(
    (result: { text: string; place_name: string; lat: number; lng: number }) => {
      setSelectedResult(result);
      setName(result.text);
      clear();
    },
    [clear]
  );

  const handleConfirm = useCallback(async () => {
    if (!selectedResult || !name.trim() || !onAddPOI) return;
    setSaving(true);
    await onAddPOI({
      name: name.trim(),
      lat: selectedResult.lat,
      lng: selectedResult.lng,
      address: selectedResult.place_name,
      category,
    });
    setSaving(false);
    handleClose();
  }, [selectedResult, name, category, onAddPOI, handleClose]);

  if (!user) return null;

  if (!expanded) {
    return (
      <div className="absolute top-3 left-12 z-10">
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-slate-700 active:bg-slate-700 transition-colors cursor-pointer shadow-lg"
        >
          <Plus className="w-3.5 h-3.5" />
          Add pin
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="absolute top-3 left-12 z-10 w-72 bg-slate-800 border border-slate-700 rounded-lg shadow-xl"
    >
      {/* Search input or selected result form */}
      {!selectedResult ? (
        <div className="relative">
          <div className="flex items-center gap-2 px-3 py-2">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search for a place..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
            />
            {loading && <Loader2 className="w-4 h-4 text-slate-400 animate-spin shrink-0" />}
            <button
              onClick={handleClose}
              className="p-0.5 text-slate-400 hover:text-white transition-colors"
              aria-label="Close search"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results dropdown */}
          {results.length > 0 && (
            <div className="border-t border-slate-700 max-h-52 overflow-y-auto">
              {results.map((result, i) => (
                <button
                  key={i}
                  onClick={() => handleSelectResult(result)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-700 active:bg-slate-700 transition-colors cursor-pointer"
                >
                  <p className="text-sm text-white truncate">{result.text}</p>
                  <p className="text-xs text-slate-400 truncate">{result.place_name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          {/* Name input */}
          <div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pin name"
              className="w-full bg-slate-700 border border-slate-600 rounded px-2.5 py-1.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-slate-500"
              maxLength={60}
            />
            <p className="text-xs text-slate-500 mt-1 truncate">{selectedResult.place_name}</p>
          </div>

          {/* Category picker */}
          <div className="flex items-center gap-1.5">
            {POI_CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.icon];
              const isActive = category === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setCategory(cat.value as POICategory)}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors cursor-pointer ${
                    isActive
                      ? 'border-white/30 bg-slate-600'
                      : 'border-slate-600 bg-slate-700 hover:bg-slate-600'
                  }`}
                  title={cat.label}
                  aria-label={cat.label}
                >
                  {Icon && <span style={{ color: cat.color }}><Icon className="w-4 h-4" /></span>}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              disabled={!name.trim() || saving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 active:bg-orange-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Add
            </button>
            <button
              onClick={handleClose}
              className="px-3 py-1.5 text-slate-400 hover:text-white text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

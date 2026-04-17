'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface PlaceLookupProps {
  value: { lat: number; lng: number };
  onChange: (center: { lat: number; lng: number }) => void;
  inputClass?: string;
}

interface Suggestion {
  mapbox_id: string;
  name: string;
  place_formatted: string;
}

export function PlaceLookup({ value, onChange, inputClass = '' }: PlaceLookupProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedName, setSelectedName] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionToken = useRef(crypto.randomUUID());
  const containerRef = useRef<HTMLDivElement>(null);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const search = useCallback((q: string) => {
    setQuery(q);
    setSelectedName('');
    if (timeout.current) clearTimeout(timeout.current);
    if (!q.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    timeout.current = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${token}&session_token=${sessionToken.current}&limit=5&types=place,locality,neighborhood,address,poi`;
        const res = await fetch(url);
        const data = await res.json();
        const items = (data.suggestions ?? []).map((s: Record<string, unknown>) => ({
          mapbox_id: s.mapbox_id as string,
          name: s.name as string,
          place_formatted: (s.place_formatted || s.full_address || '') as string,
        }));
        setSuggestions(items);
        setOpen(items.length > 0);
      } catch {
        setSuggestions([]);
      }
      setLoading(false);
    }, 300);
  }, [token]);

  const selectPlace = useCallback(async (suggestion: Suggestion) => {
    setOpen(false);
    setLoading(true);
    try {
      const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}?access_token=${token}&session_token=${sessionToken.current}`;
      const res = await fetch(url);
      const data = await res.json();
      const feature = data.features?.[0];
      if (feature) {
        const lng = feature.geometry.coordinates[0];
        const lat = feature.geometry.coordinates[1];
        onChange({ lat, lng });
        setSelectedName(`${suggestion.name}, ${suggestion.place_formatted}`);
        setQuery('');
      }
      sessionToken.current = crypto.randomUUID();
    } catch { /* ignore */ }
    setLoading(false);
    setSuggestions([]);
  }, [token, onChange]);

  const displayText = selectedName || (value.lat && value.lng ? `${value.lat.toFixed(4)}, ${value.lng.toFixed(4)}` : '');

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-xs text-stone-400 mb-1">Conference Location</label>
      <input
        type="text"
        value={query || ''}
        onChange={(e) => search(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={displayText || 'Search for a city or venue...'}
        className={inputClass}
      />
      {displayText && !query && (
        <p className="text-xs text-stone-400 mt-1">{displayText}</p>
      )}
      {loading && <p className="text-xs text-stone-500 mt-1">Searching...</p>}

      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-stone-700 bg-stone-800 shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <li
              key={s.mapbox_id}
              onClick={() => selectPlace(s)}
              className="px-3 py-2 cursor-pointer hover:bg-stone-700 text-sm text-white"
            >
              <span className="font-medium">{s.name}</span>
              {s.place_formatted && (
                <span className="text-stone-400 ml-1 text-xs">{s.place_formatted}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

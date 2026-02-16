'use client';

import { useState, useRef, useCallback } from 'react';
import { DENVER_CENTER } from '@/lib/constants';

export interface GeocoderResult {
  place_name: string;
  text: string;
  mapbox_id: string;
}

export interface SelectedResult {
  place_name: string;
  text: string;
  lat: number;
  lng: number;
}

export function useGeocoder() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocoderResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionToken = useRef(crypto.randomUUID());
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      if (timeout.current) clearTimeout(timeout.current);
      if (!q.trim()) {
        setResults([]);
        return;
      }

      timeout.current = setTimeout(async () => {
        setLoading(true);
        try {
          const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${token}&session_token=${sessionToken.current}&proximity=${DENVER_CENTER.lng},${DENVER_CENTER.lat}&limit=5&types=poi,address&country=US`;
          const res = await fetch(url);
          const data = await res.json();
          setResults(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (data.suggestions ?? []).map((s: any) => ({
              place_name: s.place_formatted ?? s.full_address ?? '',
              text: s.name,
              mapbox_id: s.mapbox_id,
            }))
          );
        } catch {
          setResults([]);
        }
        setLoading(false);
      }, 300);
    },
    [token]
  );

  const select = useCallback(
    async (mapboxId: string): Promise<SelectedResult | null> => {
      try {
        const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?access_token=${token}&session_token=${sessionToken.current}`;
        const res = await fetch(url);
        const data = await res.json();
        const feature = data.features?.[0];
        if (!feature) return null;

        // Start a new session after a retrieve (completes the session)
        sessionToken.current = crypto.randomUUID();

        return {
          place_name: feature.properties.place_formatted ?? feature.properties.full_address ?? '',
          text: feature.properties.name,
          lat: feature.geometry.coordinates[1],
          lng: feature.geometry.coordinates[0],
        };
      } catch {
        return null;
      }
    },
    [token]
  );

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
    // New session for the next search
    sessionToken.current = crypto.randomUUID();
  }, []);

  return { query, search, results, loading, select, clear };
}

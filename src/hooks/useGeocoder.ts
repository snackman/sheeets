'use client';

import { useState, useRef, useCallback } from 'react';
import { DENVER_CENTER } from '@/lib/constants';

interface GeocoderResult {
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
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${token}&proximity=${DENVER_CENTER.lng},${DENVER_CENTER.lat}&limit=5&types=poi,address`;
          const res = await fetch(url);
          const data = await res.json();
          setResults(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (data.features ?? []).map((f: any) => ({
              place_name: f.place_name,
              text: f.text,
              lat: f.center[1],
              lng: f.center[0],
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

  const clear = useCallback(() => {
    setQuery('');
    setResults([]);
  }, []);

  return { query, search, results, loading, clear };
}

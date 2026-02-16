'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { POI, POICategory } from '@/lib/types';
import { MAX_POIS } from '@/lib/constants';

export function usePOIs() {
  const { user } = useAuth();
  const [pois, setPois] = useState<POI[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch on mount when authenticated
  useEffect(() => {
    if (!user) {
      setPois([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('pois')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPois(data ?? []);
        setLoading(false);
      });
  }, [user]);

  const addPOI = useCallback(
    async (poi: {
      name: string;
      lat: number;
      lng: number;
      address?: string | null;
      category: POICategory;
      note?: string | null;
      conference?: string | null;
    }) => {
      if (!user || pois.length >= MAX_POIS) return null;
      const { data, error } = await supabase
        .from('pois')
        .insert({ ...poi, user_id: user.id })
        .select()
        .single();
      if (error || !data) return null;
      setPois((prev) => [data, ...prev]);
      return data as POI;
    },
    [user, pois.length]
  );

  const removePOI = useCallback(
    async (id: string) => {
      if (!user) return;
      await supabase.from('pois').delete().eq('id', id).eq('user_id', user.id);
      setPois((prev) => prev.filter((p) => p.id !== id));
    },
    [user]
  );

  const updatePOI = useCallback(
    async (id: string, updates: Partial<Pick<POI, 'name' | 'category' | 'note'>>) => {
      if (!user) return;
      const { data } = await supabase
        .from('pois')
        .update(updates)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();
      if (data) setPois((prev) => prev.map((p) => (p.id === id ? { ...p, ...data } : p)));
    },
    [user]
  );

  return { pois, loading, addPOI, removePOI, updatePOI };
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/types';
import { trackProfileUpdate } from '@/lib/analytics';

export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setProfile(null);
      setLoading(false);
      initialFetchDone.current = false;
      return;
    }

    // Avoid duplicate fetches for the same user
    if (initialFetchDone.current) return;

    async function fetchOrCreateProfile() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, email, display_name, x_handle, farcaster_username')
          .eq('user_id', user!.id)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch profile:', error);
          setLoading(false);
          return;
        }

        if (data) {
          setProfile(data);
        } else {
          // Lazy-create a blank profile row
          const newProfile: UserProfile = {
            user_id: user!.id,
            email: user!.email ?? null,
            display_name: null,
            x_handle: null,
            farcaster_username: null,
          };

          const { error: insertError } = await supabase
            .from('profiles')
            .insert(newProfile);

          if (insertError) {
            // Could be a race condition — try fetching again
            const { data: retryData } = await supabase
              .from('profiles')
              .select('user_id, email, display_name, x_handle, farcaster_username')
              .eq('user_id', user!.id)
              .maybeSingle();

            if (retryData) {
              setProfile(retryData);
            } else {
              console.error('Failed to create profile:', insertError);
            }
          } else {
            setProfile(newProfile);
          }
        }
      } catch (err) {
        console.error('Profile fetch error:', err);
      }
      initialFetchDone.current = true;
      setLoading(false);
    }

    fetchOrCreateProfile();
  }, [user, authLoading]);

  const updateProfile = useCallback(
    async (fields: Partial<Pick<UserProfile, 'display_name' | 'x_handle' | 'farcaster_username'>>) => {
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update(fields)
        .eq('user_id', user.id);

      if (error) {
        console.error('Failed to update profile:', error);
        return;
      }

      setProfile((prev) => (prev ? { ...prev, ...fields } : prev));
      trackProfileUpdate();
    },
    [user]
  );

  return { profile, loading, updateProfile };
}

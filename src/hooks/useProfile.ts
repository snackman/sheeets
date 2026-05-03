'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { UserProfile } from '@/lib/types';
import { trackProfileUpdate } from '@/lib/analytics';

// ── Module-level shared state ──────────────────────────────────────────
// All useProfile() instances share a single profile value and coordinate
// via a simple listener/subscriber pattern so that an update in one
// component (e.g. UserMenu) is immediately visible in every other
// component (e.g. RsvpOverlay) without requiring a context provider.

let sharedProfile: UserProfile | null = null;
let sharedLoading = true;
let sharedFetchDone = false;
let sharedFetchingForUserId: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function setSharedProfile(p: UserProfile | null) {
  sharedProfile = p;
  notify();
}

function setSharedLoading(l: boolean) {
  sharedLoading = l;
  notify();
}

function resetSharedState() {
  sharedProfile = null;
  sharedLoading = true;
  sharedFetchDone = false;
  sharedFetchingForUserId = null;
  notify();
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useProfile() {
  const { user, loading: authLoading } = useAuth();

  // Local state that mirrors the shared module-level values.
  // We subscribe to changes via `listeners` so every instance re-renders.
  const [profile, setProfile] = useState<UserProfile | null>(sharedProfile);
  const [loading, setLoading] = useState(sharedLoading);

  // Subscribe to shared state changes
  useEffect(() => {
    const handler = () => {
      setProfile(sharedProfile);
      setLoading(sharedLoading);
    };
    listeners.add(handler);
    // Sync immediately in case shared state changed before mount
    handler();
    return () => {
      listeners.delete(handler);
    };
  }, []);

  // Fetch / create profile once per user across all instances
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      resetSharedState();
      setSharedLoading(false);
      return;
    }

    // If we already fetched for this user, skip
    if (sharedFetchDone && sharedFetchingForUserId === user.id) return;

    // If a different user logged in, reset first
    if (sharedFetchingForUserId && sharedFetchingForUserId !== user.id) {
      resetSharedState();
    }

    // Mark that we are fetching for this user (prevents duplicate fetches
    // across multiple hook instances)
    if (sharedFetchingForUserId === user.id) return;
    sharedFetchingForUserId = user.id;

    async function fetchOrCreateProfile() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('user_id, email, display_name, x_handle, rsvp_name, avatar_url, telegram_handle, company')
          .eq('user_id', user!.id)
          .maybeSingle();

        if (error) {
          console.error('Failed to fetch profile:', error);
          setSharedLoading(false);
          return;
        }

        if (data) {
          setSharedProfile(data);
        } else {
          // Lazy-create a blank profile row
          const newProfile: UserProfile = {
            user_id: user!.id,
            email: user!.email ?? null,
            display_name: null,
            x_handle: null,
            rsvp_name: null,
            avatar_url: null,
            telegram_handle: null,
            company: null,
          };

          const { error: insertError } = await supabase
            .from('profiles')
            .insert(newProfile);

          if (insertError) {
            // Could be a race condition — try fetching again
            const { data: retryData } = await supabase
              .from('profiles')
              .select('user_id, email, display_name, x_handle, rsvp_name, avatar_url, telegram_handle, company')
              .eq('user_id', user!.id)
              .maybeSingle();

            if (retryData) {
              setSharedProfile(retryData);
            } else {
              console.error('Failed to create profile:', insertError);
            }
          } else {
            setSharedProfile(newProfile);
          }
        }
      } catch (err) {
        console.error('Profile fetch error:', err);
      }
      sharedFetchDone = true;
      setSharedLoading(false);
    }

    fetchOrCreateProfile();
  }, [user, authLoading]);

  const updateProfile = useCallback(
    async (fields: Partial<Pick<UserProfile, 'display_name' | 'x_handle' | 'rsvp_name' | 'telegram_handle' | 'company'>>) => {
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update(fields)
        .eq('user_id', user.id);

      if (error) {
        console.error('Failed to update profile:', error);
        return;
      }

      setSharedProfile(sharedProfile ? { ...sharedProfile, ...fields } : sharedProfile);
      trackProfileUpdate();
    },
    [user]
  );

  const uploadAvatar = useCallback(async (file: File) => {
    if (!user) return;

    const { resizeAndCropAvatar } = await import('@/lib/image-resize');
    const blob = await resizeAndCropAvatar(file);

    const path = `${user.id}/avatar.webp`;
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { upsert: true, contentType: 'image/webp' });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(path);

    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    setSharedProfile(sharedProfile ? { ...sharedProfile, avatar_url: avatarUrl } : sharedProfile);
  }, [user]);

  return { profile, loading, updateProfile, uploadAvatar };
}

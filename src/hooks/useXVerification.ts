'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

/** Ask the server to (re)evaluate X verification for the signed-in user. */
async function callXVerify(method: 'POST' | 'DELETE'): Promise<Response | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return fetch('/api/profile/x-verify', { method, headers: { Authorization: `Bearer ${token}` } });
}

export function useXVerification() {
  const { user } = useAuth();
  const [isXVerified, setIsXVerified] = useState(false);
  const [xHandle, setXHandle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch verification status from profile
  useEffect(() => {
    async function checkVerification() {
      if (!user) {
        setIsXVerified(false);
        setXHandle(null);
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('x_verified, x_handle, x_oauth_id')
        .eq('user_id', user!.id)
        .single();

      if (data) {
        setIsXVerified(data.x_verified ?? false);
        setXHandle(data.x_handle ?? null);
      }
      setLoading(false);
    }

    checkVerification();
  }, [user]);

  // After OAuth redirect, detect newly linked X identity and update profile
  useEffect(() => {
    if (!user || isXVerified) return;

    const twitterIdentity = user.identities?.find(
      (id) => id.provider === 'twitter'
    );

    if (twitterIdentity) {
      const handle = twitterIdentity.identity_data?.user_name;
      const oauthId = twitterIdentity.id;

      if (handle && oauthId) {
        // The server re-checks the linked identity with the caller's token and
        // writes the verified columns itself; the client cannot.
        callXVerify('POST')
          .then((res) => {
            if (res?.ok) {
              setIsXVerified(true);
              setXHandle(handle);
            }
          })
          .catch(() => {});
      }
    }
  }, [user, isXVerified]);

  const linkX = useCallback(async () => {
    const { error } = await supabase.auth.linkIdentity({
      provider: 'twitter',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) console.error('Failed to link X:', error);
    // Browser will redirect to X OAuth
  }, []);

  const unlinkX = useCallback(async () => {
    if (!user) return;

    const twitterIdentity = user.identities?.find(
      (id) => id.provider === 'twitter'
    );

    if (twitterIdentity) {
      await supabase.auth.unlinkIdentity(twitterIdentity);
      const res = await callXVerify('DELETE').catch(() => null);
      if (res?.ok) setIsXVerified(false);
    }
  }, [user]);

  return { isXVerified, xHandle, loading, linkX, unlinkX };
}

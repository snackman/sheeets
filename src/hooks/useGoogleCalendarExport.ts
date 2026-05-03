'use client';

import { useState, useCallback, useRef } from 'react';
import type { ETHDenverEvent } from '@/lib/types';
import type { InsertResult } from '@/lib/google-calendar';
import { trackGoogleCalendarExport, trackGoogleCalendarError } from '@/lib/analytics';

/// <reference types="../types/google-identity" />

export type GoogleCalendarStatus = 'idle' | 'authorizing' | 'exporting' | 'success' | 'error';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Load the Google Identity Services script lazily */
function loadGISScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded
    if (typeof google !== 'undefined' && google.accounts?.oauth2) {
      resolve();
      return;
    }

    // Already loading
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')));
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export function useGoogleCalendarExport() {
  const [status, setStatus] = useState<GoogleCalendarStatus>('idle');
  const [result, setResult] = useState<InsertResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const tokenClientRef = useRef<google.accounts.oauth2.TokenClient | null>(null);

  const exportToGoogleCalendar = useCallback(
    async (events: ETHDenverEvent[], timezone: string) => {
      if (!GOOGLE_CLIENT_ID) {
        setStatus('error');
        setErrorMessage('Google Calendar integration is not configured');
        trackGoogleCalendarError('missing_client_id');
        return;
      }

      if (events.length === 0) {
        setStatus('error');
        setErrorMessage('No events to export');
        return;
      }

      setStatus('authorizing');
      setErrorMessage(null);
      setResult(null);

      try {
        // Load GIS script lazily
        await loadGISScript();
      } catch {
        setStatus('error');
        setErrorMessage('Could not connect to Google. Please try again.');
        trackGoogleCalendarError('gis_load_failed');
        return;
      }

      // Create token client if not already created
      if (!tokenClientRef.current) {
        tokenClientRef.current = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: CALENDAR_SCOPE,
          callback: () => {
            // Handled in the Promise below
          },
        });
      }

      // Request access token — wraps the callback in a promise
      try {
        const tokenResponse = await new Promise<google.accounts.oauth2.TokenResponse>(
          (resolve, reject) => {
            // Re-initialize to set the correct callback for this request
            tokenClientRef.current = google.accounts.oauth2.initTokenClient({
              client_id: GOOGLE_CLIENT_ID!,
              scope: CALENDAR_SCOPE,
              callback: (response) => {
                if (response.error) {
                  reject(new Error(response.error_description || response.error));
                } else {
                  resolve(response);
                }
              },
              error_callback: (error) => {
                reject(new Error(error.message || 'Authorization failed'));
              },
            });

            tokenClientRef.current!.requestAccessToken({ prompt: 'consent' });
          }
        );

        // Got the token — now export events
        setStatus('exporting');

        const response = await fetch('/api/google-calendar/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: tokenResponse.access_token,
            events,
            timezone,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const insertResult: InsertResult = await response.json();
        setResult(insertResult);

        if (insertResult.failed > 0 && insertResult.inserted === 0) {
          setStatus('error');
          setErrorMessage(`Failed to add events. ${insertResult.errors[0]?.error || 'Please try again.'}`);
          trackGoogleCalendarError('all_failed');
        } else {
          setStatus('success');
          trackGoogleCalendarExport(insertResult.inserted, insertResult.failed);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authorization failed';

        // User closed popup or denied consent
        if (msg.includes('popup_closed') || msg.includes('access_denied')) {
          setStatus('idle');
          return;
        }

        setStatus('error');
        setErrorMessage(msg);
        trackGoogleCalendarError(msg);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setErrorMessage(null);
  }, []);

  return {
    status,
    result,
    errorMessage,
    exportToGoogleCalendar,
    reset,
  };
}

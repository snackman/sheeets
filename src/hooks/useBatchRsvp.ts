'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { ETHDenverEvent, LumaRegistrationQuestion } from '@/lib/types';
import type { ScannedFormResult } from '@/lib/luma-form-scanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WizardStep = 'select' | 'profile' | 'custom' | 'review' | 'submitting' | 'results';

export interface BatchProfileData {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  phone: string;
  telegram: string;
  xHandle: string;
  linkedin: string;
  website: string;
}

export interface ScannedEvent {
  event: ETHDenverEvent;
  lumaSlug: string;
  formResult: ScannedFormResult | null;
  scanError?: string;
}

export interface JobStatus {
  id: number;
  eventId: string;
  eventName: string;
  status: 'pending' | 'submitting' | 'success' | 'failed';
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBatchRsvp() {
  const { user } = useAuth();

  // Wizard state
  const [step, setStep] = useState<WizardStep>('select');
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [scannedEvents, setScannedEvents] = useState<Map<string, ScannedEvent>>(new Map());
  const [scanning, setScanning] = useState(false);
  const [profileData, setProfileData] = useState<BatchProfileData>({
    email: '',
    firstName: '',
    lastName: '',
    company: '',
    jobTitle: '',
    phone: '',
    telegram: '',
    xHandle: '',
    linkedin: '',
    website: '',
  });
  const [customAnswers, setCustomAnswers] = useState<Map<string, Map<string, string>>>(new Map());
  const [jobStatuses, setJobStatuses] = useState<JobStatus[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Event selection ──────────────────────────────────────────────

  const selectEvent = useCallback((eventId: string) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((eventIds: string[]) => {
    setSelectedEventIds(new Set(eventIds));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedEventIds(new Set());
  }, []);

  // ── Profile data ────────────────────────────────────────────────

  const setProfileField = useCallback((field: keyof BatchProfileData, value: string) => {
    setProfileData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ── Custom answers ──────────────────────────────────────────────

  const setAnswer = useCallback((eventId: string, questionId: string, answer: string) => {
    setCustomAnswers((prev) => {
      const next = new Map(prev);
      const eventAnswers = new Map(next.get(eventId) || []);
      eventAnswers.set(questionId, answer);
      next.set(eventId, eventAnswers);
      return next;
    });
  }, []);

  // ── Form scanning ──────────────────────────────────────────────

  const scanSelectedEvents = useCallback(async (lumaEvents: ETHDenverEvent[]) => {
    const slugMap = new Map<string, ETHDenverEvent>();
    for (const event of lumaEvents) {
      if (!selectedEventIds.has(event.id)) continue;
      try {
        const u = new URL(event.link);
        const h = u.hostname;
        if (h === 'lu.ma' || h === 'luma.com' || h === 'www.luma.com') {
          const slug = u.pathname.split('/').filter(Boolean)[0];
          if (slug) slugMap.set(slug, event);
        }
      } catch {
        // skip invalid URLs
      }
    }

    if (slugMap.size === 0) return;

    setScanning(true);
    const slugs = Array.from(slugMap.keys());

    try {
      // Scan in batches of 5
      for (let i = 0; i < slugs.length; i += 5) {
        const batch = slugs.slice(i, i + 5);
        const res = await fetch('/api/luma/scan-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slugs: batch }),
        });

        if (res.ok) {
          const { results } = await res.json();
          setScannedEvents((prev) => {
            const next = new Map(prev);
            for (const r of results) {
              const event = slugMap.get(r.slug);
              if (event) {
                next.set(event.id, {
                  event,
                  lumaSlug: r.slug,
                  formResult: r.result || null,
                  scanError: r.error,
                });
              }
            }
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Scan error:', err);
    }

    setScanning(false);
  }, [selectedEventIds]);

  // ── Navigation ──────────────────────────────────────────────────

  const hasCustomFields = useCallback(() => {
    for (const [eventId] of scannedEvents) {
      if (!selectedEventIds.has(eventId)) continue;
      const scanned = scannedEvents.get(eventId);
      if (scanned?.formResult?.questions && scanned.formResult.questions.length > 0) {
        return true;
      }
    }
    return false;
  }, [scannedEvents, selectedEventIds]);

  const nextStep = useCallback(() => {
    setStep((prev) => {
      switch (prev) {
        case 'select': return 'profile';
        case 'profile': return hasCustomFields() ? 'custom' : 'review';
        case 'custom': return 'review';
        case 'review': return 'submitting';
        default: return prev;
      }
    });
  }, [hasCustomFields]);

  const prevStep = useCallback(() => {
    setStep((prev) => {
      switch (prev) {
        case 'profile': return 'select';
        case 'custom': return 'profile';
        case 'review': return hasCustomFields() ? 'custom' : 'profile';
        case 'results': return 'review';
        default: return prev;
      }
    });
  }, [hasCustomFields]);

  // ── Submit ──────────────────────────────────────────────────────

  const submit = useCallback(async () => {
    if (!user) return;

    setStep('submitting');

    const events = Array.from(selectedEventIds)
      .map((eventId) => {
        const scanned = scannedEvents.get(eventId);
        if (!scanned) return null;
        const eventAnswers = customAnswers.get(eventId);
        return {
          eventId,
          lumaSlug: scanned.lumaSlug,
          eventName: scanned.event.name,
          eventApiId: scanned.formResult?.eventApiId || '',
          customAnswers: eventAnswers ? Object.fromEntries(eventAnswers) : undefined,
        };
      })
      .filter(Boolean);

    if (events.length === 0) {
      setStep('review');
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setStep('review');
        return;
      }

      const res = await fetch('/api/batch-rsvp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          events,
          profile: profileData,
        }),
      });

      if (res.ok) {
        const { jobs } = await res.json();
        const statuses: JobStatus[] = jobs.map((j: { id: number; event_id: string; event_name: string; status: string }) => ({
          id: j.id,
          eventId: j.event_id,
          eventName: j.event_name || '',
          status: j.status as JobStatus['status'],
        }));

        setJobStatuses(statuses);
        setStep('results');

        // Start polling for status updates
        startPolling(statuses.map((s) => s.id), token);
      } else {
        console.error('Batch RSVP submit failed');
        setStep('review');
      }
    } catch (err) {
      console.error('Submit error:', err);
      setStep('review');
    }
  }, [user, selectedEventIds, scannedEvents, customAnswers, profileData]);

  // ── Polling ─────────────────────────────────────────────────────

  const startPolling = useCallback((jobIds: number[], token: string) => {
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/batch-rsvp?ids=${jobIds.join(',')}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (res.ok) {
          const { jobs } = await res.json();
          setJobStatuses(
            jobs.map((j: { id: number; event_id: string; event_name: string; status: string; error_message?: string }) => ({
              id: j.id,
              eventId: j.event_id,
              eventName: j.event_name || '',
              status: j.status as JobStatus['status'],
              errorMessage: j.error_message,
            }))
          );

          // Stop polling if all jobs are terminal
          const allDone = jobs.every(
            (j: { status: string }) => j.status === 'success' || j.status === 'failed'
          );
          if (allDone && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Silently retry on next interval
      }
    }, 3000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Reset ───────────────────────────────────────────────────────

  const reset = useCallback(() => {
    stopPolling();
    setStep('select');
    setSelectedEventIds(new Set());
    setScannedEvents(new Map());
    setCustomAnswers(new Map());
    setJobStatuses([]);
    setScanning(false);
  }, [stopPolling]);

  return {
    // State
    step,
    selectedEventIds,
    scannedEvents,
    scanning,
    profileData,
    customAnswers,
    jobStatuses,

    // Actions
    selectEvent,
    selectAll,
    deselectAll,
    setProfileField,
    setAnswer,
    scanSelectedEvents,
    nextStep,
    prevStep,
    submit,
    reset,
    stopPolling,
  };
}

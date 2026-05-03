'use client';

import { useEffect, useCallback } from 'react';
import { CalendarPlus, Loader2, Check, AlertCircle } from 'lucide-react';
import clsx from 'clsx';
import { useGoogleCalendarExport } from '@/hooks/useGoogleCalendarExport';
import type { ETHDenverEvent } from '@/lib/types';

interface GoogleCalendarButtonProps {
  events: ETHDenverEvent[];
  timezone: string;
}

export function GoogleCalendarButton({ events, timezone }: GoogleCalendarButtonProps) {
  const { status, result, errorMessage, exportToGoogleCalendar, reset } = useGoogleCalendarExport();

  // Auto-dismiss success state after 3 seconds
  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(reset, 3000);
      return () => clearTimeout(timer);
    }
  }, [status, reset]);

  const handleClick = useCallback(() => {
    if (status === 'authorizing' || status === 'exporting') return;
    if (status === 'error') {
      reset();
      // Small delay so the reset is visible before re-triggering
      setTimeout(() => exportToGoogleCalendar(events, timezone), 100);
      return;
    }
    exportToGoogleCalendar(events, timezone);
  }, [status, events, timezone, exportToGoogleCalendar, reset]);

  if (events.length === 0) return null;

  const isLoading = status === 'authorizing' || status === 'exporting';

  return (
    <button
      onClick={handleClick}
      disabled={isLoading}
      className={clsx(
        'px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer inline-flex items-center gap-1',
        status === 'success'
          ? 'bg-emerald-500/20 text-emerald-400'
          : status === 'error'
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)] hover:border-[var(--theme-border-primary)]'
      )}
      title={
        status === 'error' && errorMessage
          ? errorMessage
          : 'Add all events to Google Calendar'
      }
    >
      {status === 'authorizing' && (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Connecting...</span>
        </>
      )}
      {status === 'exporting' && (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Adding {events.length} event{events.length !== 1 ? 's' : ''}...</span>
        </>
      )}
      {status === 'success' && (
        <>
          <Check className="w-3 h-3" />
          <span>
            Added {result?.inserted ?? events.length}
            {result?.failed ? ` (${result.failed} failed)` : ''}!
          </span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3 h-3" />
          <span>Retry</span>
        </>
      )}
      {status === 'idle' && (
        <>
          <CalendarPlus className="w-3 h-3" />
          <span className="hidden sm:inline">Google Cal</span>
        </>
      )}
    </button>
  );
}

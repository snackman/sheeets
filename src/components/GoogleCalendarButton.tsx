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
        'p-1.5 rounded transition-colors cursor-pointer',
        status === 'success'
          ? 'text-emerald-400'
          : status === 'error'
            ? 'text-red-400 hover:text-red-300'
            : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-accent)]'
      )}
      title={
        status === 'error' && errorMessage
          ? errorMessage
          : 'Add all events to Google Calendar'
      }
    >
      {isLoading ? (
        <Loader2 className="w-[18px] h-[18px] animate-spin" />
      ) : status === 'success' ? (
        <Check className="w-[18px] h-[18px]" />
      ) : status === 'error' ? (
        <AlertCircle className="w-[18px] h-[18px]" />
      ) : (
        <CalendarPlus className="w-[18px] h-[18px]" />
      )}
    </button>
  );
}

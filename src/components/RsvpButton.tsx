'use client';

import { useCallback } from 'react';
import { Check, Loader2, ExternalLink } from 'lucide-react';
import { isLumaUrl } from '@/lib/luma';
import type { RsvpStatus } from '@/hooks/useRsvp';

interface RsvpButtonProps {
  eventId: string;
  eventUrl: string | null | undefined;
  status: RsvpStatus;
  onRsvp: (eventId: string, eventUrl: string) => void;
  size?: 'sm' | 'md';
}

export function RsvpButton({
  eventId,
  eventUrl,
  status,
  onRsvp,
  size = 'sm',
}: RsvpButtonProps) {
  // Only show on Luma events
  if (!eventUrl || !isLumaUrl(eventUrl)) return null;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (status === 'loading' || status === 'confirmed') return;
      onRsvp(eventId, eventUrl);
    },
    [eventId, eventUrl, status, onRsvp]
  );

  const isSmall = size === 'sm';

  if (status === 'confirmed') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md font-medium bg-emerald-500/15 text-emerald-400 ${
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
        }`}
        title="RSVP confirmed"
      >
        <Check className={isSmall ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        RSVP'd
      </span>
    );
  }

  if (status === 'loading') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-md font-medium bg-slate-700/50 text-slate-400 ${
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
        }`}
      >
        <Loader2
          className={`animate-spin ${isSmall ? 'w-2.5 h-2.5' : 'w-3 h-3'}`}
        />
        RSVPing...
      </span>
    );
  }

  if (status === 'error') {
    return (
      <button
        onClick={handleClick}
        className={`inline-flex items-center gap-1 rounded-md font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors cursor-pointer ${
          isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
        }`}
        title="RSVP failed - click to retry"
      >
        <ExternalLink className={isSmall ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
        Retry RSVP
      </button>
    );
  }

  // idle or fallback
  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center gap-1 rounded-md font-medium bg-orange-500/15 text-orange-400 hover:bg-orange-500/25 active:bg-orange-500/30 transition-colors cursor-pointer ${
        isSmall ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'
      }`}
      title="RSVP via Luma"
    >
      <ExternalLink className={isSmall ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      RSVP
    </button>
  );
}

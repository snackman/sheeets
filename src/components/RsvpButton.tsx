'use client';

import { MailCheck, MailOpen, Clock, Loader2, AlertTriangle } from 'lucide-react';
import { isLumaUrl } from '@/lib/luma';

interface RsvpButtonProps {
  eventLink: string;
  status: 'idle' | 'confirmed' | 'pending' | 'submitting' | 'failed';
  onClick: () => void;
}

export function RsvpButton({ eventLink, status, onClick }: RsvpButtonProps) {
  if (!isLumaUrl(eventLink)) return null;

  if (status === 'confirmed') {
    return (
      <div
        className="p-1 text-green-400"
        title="RSVP'd"
        aria-label="RSVP'd"
      >
        <MailCheck className="w-4 h-4" />
      </div>
    );
  }

  if (status === 'pending') {
    return (
      <div
        className="p-1 text-yellow-400"
        title="RSVP pending"
        aria-label="RSVP pending"
      >
        <Clock className="w-4 h-4" />
      </div>
    );
  }

  if (status === 'submitting') {
    return (
      <div
        className="p-1 text-blue-400"
        title="Submitting RSVP..."
        aria-label="Submitting RSVP"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
        className="p-1 text-red-400 hover:text-red-300 transition-colors cursor-pointer"
        title="RSVP failed — click to retry"
        aria-label="RSVP failed, retry"
      >
        <AlertTriangle className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      className="p-1 text-[var(--theme-text-muted)] hover:text-orange-400 transition-colors cursor-pointer"
      title="RSVP"
      aria-label="RSVP"
    >
      <MailOpen className="w-4 h-4" />
    </button>
  );
}

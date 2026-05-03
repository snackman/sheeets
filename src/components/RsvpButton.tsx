'use client';

import { MailCheck, MailOpen } from 'lucide-react';
import { isLumaUrl } from '@/lib/luma';

interface RsvpButtonProps {
  eventLink: string;
  status: 'idle' | 'confirmed';
  onClick: () => void;
}

export function RsvpButton({ eventLink, status, onClick }: RsvpButtonProps) {
  if (!isLumaUrl(eventLink)) return null;

  if (status === 'confirmed') {
    return (
      <span
        className="p-1 text-green-400"
        title="RSVP'd"
        aria-label="RSVP'd"
      >
        <MailCheck className="w-4 h-4" />
      </span>
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

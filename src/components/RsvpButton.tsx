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
      <div
        className="p-1 hit-44 inline-flex items-center justify-center text-success-text"
        title="RSVP'd"
        aria-label="RSVP'd"
      >
        <MailCheck className="w-4 h-4" />
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      className="p-1 hit-44 inline-flex items-center justify-center text-[var(--theme-text-muted)] hover:text-warn-text transition-colors cursor-pointer"
      title="RSVP"
      aria-label="RSVP"
    >
      <MailOpen className="w-4 h-4" />
    </button>
  );
}

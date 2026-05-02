'use client';

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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-[10px] font-semibold">
        ✓ RSVP'd
      </span>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onClick(); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-orange-400/50 text-orange-400 text-[10px] font-semibold hover:bg-orange-400/10 transition-colors cursor-pointer"
    >
      RSVP
    </button>
  );
}

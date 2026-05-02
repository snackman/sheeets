'use client';

import { Check } from 'lucide-react';

interface RsvpButtonProps {
  status: 'idle' | 'confirmed';
  onClick: (e: React.MouseEvent) => void;
}

export function RsvpButton({ status, onClick }: RsvpButtonProps) {
  if (status === 'confirmed') {
    return (
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-green-500/40 text-green-400 bg-green-500/10 cursor-default"
        title="You RSVP'd to this event"
      >
        <Check className="w-3 h-3" />
        RSVP&apos;d
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors cursor-pointer"
      title="RSVP to this event"
    >
      RSVP
    </button>
  );
}

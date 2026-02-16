'use client';

import { ExternalLink, Check } from 'lucide-react';

interface RsvpButtonProps {
  status: 'idle' | 'confirmed';
  onClick: () => void;
}

export function RsvpButton({ status, onClick }: RsvpButtonProps) {
  const isConfirmed = status === 'confirmed';

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
        isConfirmed
          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
          : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
      }`}
      title={isConfirmed ? "You've RSVP'd to this event" : 'RSVP to this event'}
    >
      {isConfirmed ? (
        <>
          <Check className="w-3 h-3" />
          <span>RSVP&apos;d</span>
        </>
      ) : (
        <>
          <ExternalLink className="w-3 h-3" />
          <span>RSVP</span>
        </>
      )}
    </button>
  );
}

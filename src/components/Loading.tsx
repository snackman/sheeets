'use client';

import { Loader2 } from 'lucide-react';

export function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Loader2 className="w-10 h-10 animate-spin" style={{ color: 'var(--theme-accent)' }} />
      <p className="text-[var(--theme-text-secondary)] text-sm">Loading events...</p>
    </div>
  );
}

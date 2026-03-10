'use client';

import { Loader2 } from 'lucide-react';

export function Loading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <Loader2 className="w-10 h-10 text-[var(--accent)] animate-spin" />
      <p className="text-[var(--muted)] text-sm">Loading events...</p>
    </div>
  );
}

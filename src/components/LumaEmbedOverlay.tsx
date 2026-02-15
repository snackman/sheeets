'use client';

import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Check, X } from 'lucide-react';

interface LumaEmbedOverlayProps {
  lumaUrl: string;
  eventId: string;
  onClose: () => void;
  onComplete?: (eventId: string) => void;
}

/**
 * Modal overlay that opens the Luma RSVP page in a new tab.
 * Luma blocks iframe embedding (X-Frame-Options: sameorigin),
 * so we open in a new tab and let the user confirm when done.
 */
export function LumaEmbedOverlay({
  lumaUrl,
  eventId,
  onClose,
  onComplete,
}: LumaEmbedOverlayProps) {
  // Ensure lumaUrl is absolute
  const fullUrl = lumaUrl.startsWith('http') ? lumaUrl : `https://${lumaUrl}`;

  // Open Luma in a new tab on mount
  useEffect(() => {
    window.open(fullUrl, '_blank');
  }, [fullUrl]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDone = useCallback(() => {
    onComplete?.(eventId);
    onClose();
  }, [eventId, onComplete, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm mx-4 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <span className="text-sm font-medium text-white">RSVP on Luma</span>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5 text-center space-y-4">
          <p className="text-sm text-slate-300">
            Luma has been opened in a new tab. Complete your RSVP there, then come back and tap <strong>Done</strong>.
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleDone}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              Done
            </button>

            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Open Luma
            </a>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

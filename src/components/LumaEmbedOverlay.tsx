'use client';

import { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface LumaEmbedOverlayProps {
  lumaUrl: string;
  eventId: string;
  onClose: () => void;
  onComplete?: (eventId: string) => void;
}

/**
 * Full-screen overlay that embeds the Luma checkout page in an iframe.
 * Used as a fallback when the server-side RSVP fails (paid events,
 * approval-gated, custom questions, etc.).
 */
export function LumaEmbedOverlay({
  lumaUrl,
  eventId,
  onClose,
  onComplete,
}: LumaEmbedOverlayProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Prevent body scroll while overlay is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleDone = useCallback(() => {
    onComplete?.(eventId);
    onClose();
  }, [eventId, onComplete, onClose]);

  // Ensure lumaUrl is absolute
  const embedUrl = lumaUrl.startsWith('http') ? lumaUrl : `https://${lumaUrl}`;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Content */}
      <div className="relative flex flex-col w-full h-full max-w-lg mx-auto my-4 sm:my-8 z-10">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 rounded-t-xl border border-slate-700 border-b-0 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white">RSVP on Luma</span>
            <span className="text-xs text-slate-400">Free events register instantly</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDone}
              className="px-3 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-colors cursor-pointer"
            >
              Done
            </button>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Close RSVP overlay"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Iframe */}
        <div className="flex-1 bg-white rounded-b-xl overflow-hidden border border-slate-700 border-t-0 min-h-0">
          <iframe
            ref={iframeRef}
            src={embedUrl}
            className="w-full h-full border-0"
            title="Luma RSVP"
            allow="payment"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

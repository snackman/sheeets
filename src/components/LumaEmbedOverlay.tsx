'use client';

import { useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Check, X } from 'lucide-react';

interface LumaEmbedOverlayProps {
  lumaUrl: string;
  eventId: string;
  lumaApiId?: string;
  onClose: () => void;
  onComplete?: (eventId: string) => void;
}

export function LumaEmbedOverlay({
  lumaUrl,
  eventId,
  lumaApiId,
  onClose,
  onComplete,
}: LumaEmbedOverlayProps) {
  const fullUrl = lumaUrl.startsWith('http') ? lumaUrl : `https://${lumaUrl}`;
  const checkoutRef = useRef<HTMLAnchorElement>(null);
  const scriptLoaded = useRef(false);

  // Load Luma's checkout-button.js and auto-trigger
  useEffect(() => {
    if (!lumaApiId) return;

    // Clean up any existing Luma scripts/overlays
    const existingScript = document.getElementById('luma-checkout');
    if (existingScript) existingScript.remove();

    const script = document.createElement('script');
    script.id = 'luma-checkout';
    script.src = 'https://embed.lu.ma/checkout-button.js';
    script.onload = () => {
      scriptLoaded.current = true;
      // Auto-click the checkout button after a short delay to let Luma initialize
      setTimeout(() => {
        checkoutRef.current?.click();
      }, 300);
    };
    document.head.appendChild(script);

    return () => {
      // Clean up Luma overlay and script on unmount
      const overlay = document.querySelector('.luma-checkout--overlay');
      if (overlay) overlay.remove();
      const lumaScript = document.getElementById('luma-checkout');
      if (lumaScript) lumaScript.remove();
    };
  }, [lumaApiId]);

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

  // If no lumaApiId, fall back to link-out approach
  if (!lumaApiId) {
    return createPortal(
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative z-10 w-full max-w-sm mx-4 bg-slate-800 rounded-xl border border-slate-700 shadow-2xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <span className="text-sm font-medium text-white">RSVP on Luma</span>
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-4 py-5 text-center space-y-4">
            <p className="text-sm text-slate-300">
              Complete your RSVP on Luma, then come back and tap <strong>Done</strong>.
            </p>
            <div className="flex flex-col gap-2">
              <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 rounded-lg transition-colors">
                <ExternalLink className="w-4 h-4" />
                Open Luma
              </a>
              <button onClick={handleDone} className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded-lg transition-colors cursor-pointer">
                <Check className="w-4 h-4" />
                Done
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // With lumaApiId: use Luma's embed widget
  return createPortal(
    <>
      {/* Hidden Luma checkout trigger button */}
      <a
        ref={checkoutRef}
        href={fullUrl}
        className="luma-checkout--button"
        data-luma-action="checkout"
        data-luma-event-id={lumaApiId}
        style={{ display: 'none' }}
      >
        Register
      </a>

      {/* Our own Done overlay that appears behind Luma's overlay */}
      <div className="fixed inset-0 z-[99] flex items-end justify-center pb-8 pointer-events-none">
        <div className="pointer-events-auto flex gap-2">
          <button
            onClick={handleDone}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 rounded-full shadow-lg transition-colors cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Done - I RSVP&apos;d
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-slate-700 text-slate-300 hover:bg-slate-600 rounded-full shadow-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/contexts/AuthContext';
import { getLumaSlug } from '@/lib/luma';

interface RsvpOverlayProps {
  event: { id: string; name: string; link: string };
  onConfirm: (eventId: string) => void;
  onClose: () => void;
}

function CopyField({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: ignore
    }
  }, [value]);

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-700/50 rounded-lg">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{label}</p>
        <p className={`text-sm truncate ${value ? 'text-white' : 'text-slate-500 italic'}`}>
          {value || 'Not set'}
        </p>
      </div>
      {value && (
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-600 transition-colors cursor-pointer"
          title={`Copy ${label.toLowerCase()}`}
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

export function RsvpOverlay({ event, onConfirm, onClose }: RsvpOverlayProps) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const lumaLinkRef = useRef<HTMLAnchorElement>(null);
  const scriptLoadedRef = useRef(false);

  const slug = getLumaSlug(event.link);
  const displayName = profile?.rsvp_name || profile?.display_name || null;
  const email = profile?.email || user?.email || null;

  // Load Luma checkout script on mount
  useEffect(() => {
    if (scriptLoadedRef.current) return;

    const existing = document.querySelector('script[src*="embed.lu.ma/checkout-button"]');
    if (existing) {
      scriptLoadedRef.current = true;
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://embed.lu.ma/checkout-button.js';
    script.async = true;
    document.head.appendChild(script);
    scriptLoadedRef.current = true;

    return () => {
      // Clean up Luma overlay elements on unmount
      const overlays = document.querySelectorAll('.luma-checkout--overlay');
      overlays.forEach((el) => el.remove());
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOpenLumaForm = useCallback(() => {
    if (lumaLinkRef.current) {
      lumaLinkRef.current.click();
    }
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(event.id);
  }, [onConfirm, event.id]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-white truncate">{event.name}</h3>
            <p className="text-xs text-slate-400">RSVP via Luma</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0 ml-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile fields */}
        <div className="p-4 space-y-3">
          {user ? (
            <>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Your Details</p>
              <div className="space-y-2">
                <CopyField label="Name" value={displayName} />
                <CopyField label="Email" value={email} />
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500 italic text-center py-2">
              Log in to see your saved info
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="px-4 pb-4 space-y-2">
          <button
            onClick={handleOpenLumaForm}
            className="w-full py-2.5 px-4 bg-orange-500 hover:bg-orange-600 active:bg-orange-600 text-white font-medium text-sm rounded-lg transition-colors cursor-pointer"
          >
            Open RSVP Form
          </button>
          <button
            onClick={handleConfirm}
            className="w-full py-2.5 px-4 bg-green-600 hover:bg-green-700 active:bg-green-700 text-white font-medium text-sm rounded-lg transition-colors cursor-pointer"
          >
            Done - I RSVP&apos;d
          </button>
          <button
            onClick={onClose}
            className="w-full py-1.5 text-slate-500 hover:text-slate-300 text-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>

        {/* Hidden Luma checkout trigger */}
        {slug && (
          <a
            ref={lumaLinkRef}
            href={event.link}
            data-luma-action="checkout"
            data-luma-event-id={slug}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>,
    document.body
  );
}

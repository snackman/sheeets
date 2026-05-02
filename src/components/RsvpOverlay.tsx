'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, ExternalLink } from 'lucide-react';
import { useProfile } from '@/hooks/useProfile';
import { getLumaSlug } from '@/lib/luma';

interface RsvpOverlayProps {
  eventId: string;
  eventName: string;
  lumaUrl: string;
  onConfirm: (eventId: string, eventName: string) => void;
  onClose: () => void;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--theme-bg-tertiary)]">
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--theme-text-muted)] uppercase tracking-wider">{label}</p>
        <p className="text-sm text-[var(--theme-text-primary)] truncate">{value}</p>
      </div>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1.5 rounded-md hover:bg-[var(--theme-bg-card-hover)] transition-colors cursor-pointer"
        title={`Copy ${label.toLowerCase()}`}
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-400" />
        ) : (
          <Copy className="w-4 h-4 text-[var(--theme-text-secondary)]" />
        )}
      </button>
    </div>
  );
}

export function RsvpOverlay({ eventId, eventName, lumaUrl, onConfirm, onClose }: RsvpOverlayProps) {
  const { profile } = useProfile();
  const [stage, setStage] = useState<'copy' | 'widget'>('copy');
  const lumaLinkRef = useRef<HTMLAnchorElement>(null);
  const slug = getLumaSlug(lumaUrl);

  // Load Luma checkout script
  useEffect(() => {
    if (document.querySelector('script[src*="checkout-button.js"]')) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.lu.ma/checkout-button.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOpenWidget = useCallback(() => {
    setStage('widget');
    // Small delay so Luma script has time to bind
    setTimeout(() => {
      lumaLinkRef.current?.click();
    }, 100);
  }, []);

  const handleDone = useCallback(() => {
    onConfirm(eventId, eventName);
  }, [eventId, eventName, onConfirm]);

  const displayName = profile?.rsvp_name || profile?.display_name || '';
  const displayEmail = profile?.email || '';

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-xl shadow-2xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)]">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[var(--theme-text-primary)]">RSVP</h3>
            <p className="text-xs text-[var(--theme-text-secondary)] truncate">{eventName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer shrink-0 ml-2"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {stage === 'copy' && (
            <>
              {/* Profile fields for copy-paste */}
              {displayName || displayEmail ? (
                <>
                  <p className="text-xs text-[var(--theme-text-muted)]">
                    Copy your details to paste into the RSVP form:
                  </p>
                  {displayName && <CopyField label="Name" value={displayName} />}
                  {displayEmail && <CopyField label="Email" value={displayEmail} />}
                </>
              ) : (
                <p className="text-xs text-[var(--theme-text-muted)]">
                  Click below to open the RSVP form on Luma.
                </p>
              )}

              <button
                onClick={handleOpenWidget}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] text-sm font-medium transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                Open RSVP Form
              </button>
            </>
          )}

          {stage === 'widget' && (
            <>
              <p className="text-xs text-[var(--theme-text-muted)] text-center">
                Complete the RSVP form in the Luma popup, then click &quot;Done&quot; below.
              </p>

              <div className="flex gap-2">
                <button
                  onClick={handleDone}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors cursor-pointer"
                >
                  Done — I RSVP&apos;d
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-lg border border-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] text-sm font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>

        {/* Hidden Luma checkout trigger */}
        {slug && (
          <a
            ref={lumaLinkRef}
            href={`https://lu.ma/event/${slug}`}
            className="hidden"
            data-luma-action="checkout"
            data-luma-event-id={slug}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

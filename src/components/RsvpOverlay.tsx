'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';

interface RsvpOverlayProps {
  eventName: string;
  lumaUrl: string;
  userName?: string | null;
  userEmail?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h !== 'lu.ma' && h !== 'luma.com' && h !== 'www.luma.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing if clipboard API unavailable
    }
  }, [value]);

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <div className="min-w-0 flex-1">
        <span className="block text-[9px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
          {label}
        </span>
        <span className="block text-xs text-[var(--theme-text-primary)] truncate">
          {value}
        </span>
      </div>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1.5 rounded-md hover:bg-[var(--theme-bg-tertiary)] transition-colors cursor-pointer"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-green-400" />
        ) : (
          <Copy className="w-3.5 h-3.5 text-[var(--theme-text-secondary)]" />
        )}
      </button>
    </div>
  );
}

export function RsvpOverlay({
  eventName,
  lumaUrl,
  userName,
  userEmail,
  onConfirm,
  onClose,
}: RsvpOverlayProps) {
  const slug = getLumaSlug(lumaUrl);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  if (!slug) return null;

  const hasCopyFields = userName || userEmail;
  const embedUrl = `https://lu.ma/embed/event/${slug}/simple`;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Dark backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal container: bottom-sheet on mobile, centered on desktop */}
      <div
        className="relative w-full sm:max-w-lg bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col"
        style={{ height: '85vh', maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Use a CSS media query workaround via Tailwind for desktop height */}
        <style>{`
          @media (min-width: 640px) {
            .rsvp-overlay-panel {
              height: 80vh !important;
              max-height: 80vh !important;
            }
          }
        `}</style>
        <div className="rsvp-overlay-panel flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] shrink-0">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-[var(--theme-text-primary)] truncate">
                RSVP
              </h2>
              <p className="text-xs text-[var(--theme-text-secondary)] truncate">
                {eventName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer shrink-0 ml-2"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Sticky copy-fields bar */}
          {hasCopyFields && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--theme-border-primary)] bg-[var(--theme-bg-tertiary)] shrink-0">
              {userName && <CopyField label="Name" value={userName} />}
              {userEmail && <CopyField label="Email" value={userEmail} />}
            </div>
          )}

          {/* Luma iframe -- fills remaining space */}
          <div className="flex-1 min-h-0">
            <iframe
              src={embedUrl}
              className="w-full h-full border-0"
              allow="payment"
              title={`RSVP for ${eventName}`}
            />
          </div>

          {/* Bottom action buttons */}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] shrink-0">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--theme-border-primary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] text-sm font-medium transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 px-4 py-2.5 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition-colors cursor-pointer"
            >
              Done — I RSVP'd
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

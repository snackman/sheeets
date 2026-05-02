'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';
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
  const slug = getLumaSlug(lumaUrl);

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
  }, []);

  const handleDone = useCallback(() => {
    onConfirm(eventId, eventName);
  }, [eventId, eventName, onConfirm]);

  const displayName = profile?.rsvp_name || profile?.display_name || '';
  const displayEmail = profile?.email || '';

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className={`relative bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] shadow-2xl w-full flex flex-col ${
          stage === 'widget'
            ? 'max-w-lg h-[85vh] sm:h-[80vh] sm:rounded-xl rounded-t-xl'
            : 'max-w-sm sm:rounded-xl rounded-t-xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] shrink-0">
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
        {stage === 'copy' && (
          <div className="p-4 space-y-3">
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
                Click below to open the RSVP form.
              </p>
            )}

            <button
              onClick={handleOpenWidget}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] text-sm font-medium transition-colors cursor-pointer"
            >
              Open RSVP Form
            </button>
          </div>
        )}

        {stage === 'widget' && slug && (
          <>
            {/* Luma embed iframe */}
            <div className="flex-1 min-h-0">
              <iframe
                src={`https://lu.ma/embed/event/${slug}/simple`}
                className="w-full h-full border-0"
                allow="payment"
                title="Luma RSVP"
              />
            </div>

            {/* Bottom bar */}
            <div className="shrink-0 p-3 border-t border-[var(--theme-border-primary)] flex gap-2">
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
    </div>,
    document.body
  );
}

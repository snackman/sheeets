'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Copy, Check, Loader2 } from 'lucide-react';
import { trackLockScreenOpen, trackLockScreenCopy, trackLockScreenDownload } from '@/lib/analytics';
import type { SocialLink } from '@/lib/social-urls';
import LockScreenTemplate from './LockScreenTemplate';

interface LockScreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string | null;
  company: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  socialLinks: SocialLink[];
}

export function LockScreenModal({
  isOpen,
  onClose,
  displayName,
  company,
  jobTitle,
  avatarUrl,
  socialLinks,
}: LockScreenModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const cardRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef(false);

  // Generate preview image
  const generatePreview = useCallback(async () => {
    if (!cardRef.current) {
      setPreviewUrl(null);
      return;
    }
    setGenerating(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 1,
        backgroundColor: '#0c0a09',
        style: { position: 'static', left: '0' },
      });
      setPreviewUrl(dataUrl);
    } catch (err) {
      console.error('Lock screen preview generation failed:', err);
    } finally {
      setGenerating(false);
    }
  }, []);

  // Generate preview when modal opens
  useEffect(() => {
    if (!isOpen) return;
    // Small delay to allow template to mount
    const timer = setTimeout(() => {
      generatePreview();
    }, 200);
    return () => clearTimeout(timer);
  }, [isOpen, generatePreview]);

  // Track open event
  useEffect(() => {
    if (isOpen && !trackedRef.current) {
      trackLockScreenOpen();
      trackedRef.current = true;
    }
    if (!isOpen) {
      trackedRef.current = false;
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPreviewUrl(null);
      setCopyStatus('idle');
    }
  }, [isOpen]);

  const handleCopy = useCallback(async () => {
    if (!cardRef.current) return;
    setCopyStatus('copying');
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(cardRef.current, {
        pixelRatio: 1,
        backgroundColor: '#0c0a09',
        style: { position: 'static', left: '0' },
      });
      if (!blob) {
        setCopyStatus('idle');
        return;
      }
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      trackLockScreenCopy();
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2000);
    } catch (err) {
      console.error('Copy to clipboard failed:', err);
      setCopyStatus('idle');
    }
  }, []);

  const handleDownload = useCallback(async () => {
    if (!cardRef.current) return;
    try {
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(cardRef.current, {
        pixelRatio: 1,
        backgroundColor: '#0c0a09',
        style: { position: 'static', left: '0' },
      });
      if (!blob) return;
      trackLockScreenDownload();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (displayName || 'card').toLowerCase().replace(/\s+/g, '-');
      a.download = `lock-screen-${safeName}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  }, [displayName]);

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
        <div
          className="bg-[var(--theme-bg-secondary)] border border-[var(--theme-border-primary)] rounded-xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--theme-border-primary)] shrink-0">
            <h2 className="text-base font-bold text-[var(--theme-text-primary)]">Lock Screen Card</h2>
            <button
              onClick={onClose}
              className="p-1 text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            <p className="text-xs text-[var(--theme-text-secondary)]">
              Set this as your phone lock screen so people can scan your QR codes at conferences.
            </p>

            {/* Preview area */}
            <div className="rounded-lg border border-[var(--theme-border-primary)] bg-[var(--theme-bg-primary)] overflow-hidden">
              {generating && !previewUrl ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 text-[var(--theme-text-secondary)] animate-spin" />
                </div>
              ) : previewUrl ? (
                <div className="relative">
                  {generating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--theme-bg-primary)]/60 z-10">
                      <Loader2 className="w-5 h-5 text-[var(--theme-text-secondary)] animate-spin" />
                    </div>
                  )}
                  <img
                    src={previewUrl}
                    alt="Lock screen card preview"
                    className="w-full h-auto block"
                  />
                </div>
              ) : (
                <div className="flex items-center justify-center py-16 text-[var(--theme-text-muted)] text-sm">
                  Generating preview...
                </div>
              )}
            </div>
          </div>

          {/* Footer buttons */}
          <div className="px-4 py-3 border-t border-[var(--theme-border-primary)] flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopy}
              disabled={!previewUrl || copyStatus === 'copying'}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                copyStatus === 'copied'
                  ? 'bg-green-600 text-white'
                  : 'bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)]'
              }`}
            >
              {copyStatus === 'copying' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Copying...
                </>
              ) : copyStatus === 'copied' ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              disabled={!previewUrl}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--theme-bg-tertiary)] hover:bg-[var(--theme-bg-card-hover)] text-[var(--theme-text-primary)] rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Download PNG
            </button>
          </div>
        </div>
      </div>

      {/* Offscreen template for image generation */}
      <LockScreenTemplate
        ref={cardRef}
        displayName={displayName}
        company={company}
        jobTitle={jobTitle}
        avatarUrl={avatarUrl}
        socialLinks={socialLinks}
      />
    </>,
    document.body
  );
}

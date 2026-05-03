'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Copy, Check, Loader2, ChevronDown } from 'lucide-react';
import { trackLockScreenOpen, trackLockScreenCopy, trackLockScreenDownload } from '@/lib/analytics';
import type { SocialLink } from '@/lib/social-urls';
import LockScreenTemplate from './LockScreenTemplate';

const PHONE_PRESETS = [
  { label: 'iPhone 16 Pro Max', w: 1320, h: 2868 },
  { label: 'iPhone 16 Pro', w: 1206, h: 2622 },
  { label: 'iPhone 16 / 15 / 14', w: 1170, h: 2532 },
  { label: 'iPhone SE', w: 750, h: 1334 },
  { label: 'Samsung Galaxy S24 Ultra', w: 1440, h: 3120 },
  { label: 'Samsung Galaxy S24', w: 1080, h: 2340 },
  { label: 'Google Pixel 9 Pro', w: 1280, h: 2856 },
  { label: 'Google Pixel 9', w: 1080, h: 2424 },
] as const;

interface LockScreenModalProps {
  isOpen: boolean;
  onClose: () => void;
  displayName: string | null;
  company: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  socialLinks: SocialLink[];
  friendCode: string | null;
}

export function LockScreenModal({
  isOpen,
  onClose,
  displayName,
  company,
  jobTitle,
  avatarUrl,
  socialLinks,
  friendCode,
}: LockScreenModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const trackedRef = useRef(false);

  // Desktop detection: non-touch primary pointer or wide screen
  const isDesktop = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(pointer: fine)').matches && window.screen.width > 1024;
  }, []);

  // Phone picker state (only used on desktop)
  const [selectedPreset, setSelectedPreset] = useState(2); // default: iPhone 16/15/14
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [pickerDone, setPickerDone] = useState(false);

  // Build full list of available QR items (social links + friend link)
  const allLinks: SocialLink[] = useMemo(() => {
    const links = [...socialLinks];
    if (friendCode) {
      links.push({
        platform: 'friend',
        label: 'plan.wtf',
        url: `${typeof window !== 'undefined' ? window.location.origin : ''}?fc=${friendCode}`,
      });
    }
    return links;
  }, [socialLinks, friendCode]);

  // QR selection state — which platforms are toggled on
  const [enabledQrs, setEnabledQrs] = useState<Set<string>>(new Set());

  // Reset enabled set when allLinks changes
  useEffect(() => {
    setEnabledQrs(new Set(allLinks.map(l => l.platform)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLinks.length]);

  // Filtered links based on selection
  const filteredLinks = useMemo(() => allLinks.filter(l => enabledQrs.has(l.platform)), [allLinks, enabledQrs]);

  // Resolve final screen dimensions
  const screenDims = useMemo(() => {
    if (!isDesktop) {
      // Mobile: auto-detect
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const sw = typeof window !== 'undefined' ? window.screen.width : 1170;
      const sh = typeof window !== 'undefined' ? window.screen.height : 2532;
      return { width: Math.round(sw * dpr), height: Math.round(sh * dpr) };
    }
    if (useCustom) {
      const w = parseInt(customW, 10);
      const h = parseInt(customH, 10);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    const preset = PHONE_PRESETS[selectedPreset];
    return { width: preset.w, height: preset.h };
  }, [isDesktop, selectedPreset, useCustom, customW, customH]);

  // Preload logo as data URL so html-to-image can embed it
  useEffect(() => {
    if (!isOpen) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setLogoDataUrl(canvas.toDataURL('image/png'));
      }
    };
    img.src = '/logo.png';
  }, [isOpen]);

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

  // Generate preview when modal opens (mobile) or after picker done (desktop)
  useEffect(() => {
    if (!isOpen) return;
    if (isDesktop && !pickerDone) return;
    // Small delay to allow template to mount
    const timer = setTimeout(() => {
      generatePreview();
    }, 200);
    return () => clearTimeout(timer);
  }, [isOpen, isDesktop, pickerDone, generatePreview, enabledQrs]);

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
      setPickerDone(false);
      setLogoDataUrl(null);
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
              Set this as your lock screen to make it easy for people to scan your contact info.
            </p>

            {/* QR code selection */}
            {allLinks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-[var(--theme-text-primary)]">QR codes to include</p>
                {allLinks.map((link) => (
                  <label key={link.platform} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledQrs.has(link.platform)}
                      onChange={() => {
                        setEnabledQrs(prev => {
                          const next = new Set(prev);
                          if (next.has(link.platform)) next.delete(link.platform);
                          else next.add(link.platform);
                          return next;
                        });
                      }}
                      className="w-3.5 h-3.5 rounded accent-[var(--theme-accent)]"
                    />
                    <span className="text-sm text-[var(--theme-text-secondary)]">
                      {link.platform === 'friend' ? 'Friend link (plan.wtf)' : link.platform === 'x' ? `X (@${link.label.replace('@', '')})` : link.platform === 'telegram' ? `Telegram (${link.label})` : `LinkedIn`}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Phone picker (desktop only) */}
            {isDesktop && !pickerDone && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-[var(--theme-text-primary)]">Select your phone model</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {PHONE_PRESETS.map((preset, i) => (
                    <button
                      key={i}
                      onClick={() => { setSelectedPreset(i); setUseCustom(false); }}
                      className={`text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                        !useCustom && selectedPreset === i
                          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                          : 'bg-[var(--theme-bg-primary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)]'
                      }`}
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="ml-2 opacity-60">{preset.w}&times;{preset.h}</span>
                    </button>
                  ))}
                </div>

                {/* Custom size toggle */}
                <button
                  onClick={() => setUseCustom(!useCustom)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer flex items-center justify-between ${
                    useCustom
                      ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                      : 'bg-[var(--theme-bg-primary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)]'
                  }`}
                >
                  <span className="font-medium">Custom size</span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${useCustom ? 'rotate-180' : ''}`} />
                </button>

                {useCustom && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      placeholder="Width"
                      className="flex-1 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:outline-none focus:border-[var(--theme-accent)] placeholder:text-[var(--theme-text-muted)]"
                    />
                    <span className="text-[var(--theme-text-muted)] text-sm">&times;</span>
                    <input
                      type="number"
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      placeholder="Height"
                      className="flex-1 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-primary)] rounded-lg px-3 py-2 text-sm text-[var(--theme-text-primary)] focus:outline-none focus:border-[var(--theme-accent)] placeholder:text-[var(--theme-text-muted)]"
                    />
                  </div>
                )}

                <button
                  onClick={() => setPickerDone(true)}
                  disabled={useCustom && (!parseInt(customW, 10) || !parseInt(customH, 10))}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Generate Card
                </button>
              </div>
            )}

            {/* Preview area */}
            {(!isDesktop || pickerDone) && (
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
            )}
          </div>

          {/* Footer buttons */}
          <div className={`px-4 py-3 border-t border-[var(--theme-border-primary)] flex items-center gap-2 shrink-0 ${isDesktop && !pickerDone ? 'hidden' : ''}`}>
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
        socialLinks={filteredLinks}
        screenWidth={screenDims.width}
        screenHeight={screenDims.height}
        logoDataUrl={logoDataUrl ?? undefined}
      />
    </>,
    document.body
  );
}

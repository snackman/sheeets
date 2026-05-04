'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, Copy, Check, Loader2, ChevronDown } from 'lucide-react';
import { trackLockScreenOpen, trackLockScreenCopy, trackLockScreenDownload } from '@/lib/analytics';
import type { SocialLink } from '@/lib/social-urls';
import LockScreenTemplate from './LockScreenTemplate';

function PlatformIcon({ platform }: { platform: string }) {
  const cls = "w-5 h-5 shrink-0";
  switch (platform) {
    case 'x':
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor"><path d="M17.176 4h2.645l-5.78 6.606 6.8 8.994h-4.676l-4.17-5.453-4.77 5.453H4.58l6.18-7.066L4.2 4h4.795l3.77 4.984zm-.928 14.016h1.466L8.005 5.506H6.44z" /></svg>;
    case 'telegram':
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor"><path d="M11.944 3A9 9 0 0 0 3 12a9 9 0 0 0 9 9 9 9 0 0 0 9-9 9 9 0 0 0-9-9zm3.722 5.418c.075-.001.241.017.349.105a.38.38 0 0 1 .128.244c.012.07.027.23.015.354-.135 1.424-.721 4.877-1.02 6.47-.126.675-.374.901-.615.923-.522.049-.919-.345-1.425-.677-.792-.52-1.24-.843-2.009-1.35-.889-.585-.313-.908.194-1.433.133-.138 2.435-2.233 2.48-2.423.006-.024.011-.113-.042-.159s-.13-.031-.187-.018c-.08.018-1.345.856-3.796 2.51-.36.247-.685.367-.977.36-.321-.006-.939-.181-1.399-.33-.564-.184-1.012-.281-.973-.592.02-.162.244-.328.67-.498 2.624-1.143 4.372-1.897 5.249-2.261 2.499-1.04 3.019-1.221 3.357-1.226z" /></svg>;
    case 'linkedin':
      return <svg viewBox="0 0 24 24" className={cls} fill="currentColor"><path d="M19.336 19.339h-3.065v-4.805c0-1.146-.023-2.62-1.596-2.62-1.597 0-1.842 1.247-1.842 2.536v4.889h-3.065V9.75h2.943v1.347h.042c.41-.776 1.412-1.596 2.907-1.596 3.107 0 3.68 2.044 3.68 4.703v5.135zM6.749 8.397c-.985 0-1.78-.8-1.78-1.782S5.764 4.833 6.749 4.833c.983 0 1.78.8 1.78 1.782s-.797 1.782-1.78 1.782zm1.537 10.942H5.212V9.75h3.074v9.589z" /></svg>;
    case 'friend':
      return <svg viewBox="0 0 360 360" className={cls} fill="currentColor"><g transform="translate(50 40)"><rect y="71.62" width="260.39" height="9.16" /><rect x="65.86" y="3.83" width="18.38" height="51.31" rx="8.42" fill="none" stroke="currentColor" strokeWidth="7.66" /><rect x="176.14" y="3.83" width="18.38" height="51.31" rx="8.42" fill="none" stroke="currentColor" strokeWidth="7.66" /><path d="M56.67 40.16H23.04c-4.93 0-8.92 3.99-8.92 8.92v205.88c0 4.93 3.99 8.92 8.92 8.92h214.06c4.92 0 8.92-3.99 8.92-8.92V49.08c0-4.93-3.99-8.92-8.92-8.92h-33.38V26.04h33.38l.59.01c12.45.32 22.45 10.51 22.45 23.03v205.88l-.01.6c-.31 12.25-10.19 22.12-22.44 22.44l-.59.01H23.04l-.59-.01C10.19 277.68.32 267.81.01 255.55L0 254.96V49.08C0 36.55 10 26.36 22.45 26.05l.59-.01h33.63v14.12zm110.28 0H93.43V26.04h73.52v14.12z" /><rect x="58.2" y="106.45" width="37.99" height="37.99" rx="6.13" /><rect x="58.2" y="151.79" width="37.99" height="37.99" rx="6.13" /><rect x="110.89" y="151.79" width="37.99" height="37.99" rx="6.13" /><rect x="110.89" y="197.13" width="37.99" height="37.99" rx="6.13" /><rect x="163.58" y="151.79" width="37.99" height="37.99" rx="6.13" /><rect x="58.2" y="197.13" width="37.99" height="37.99" rx="6.13" /><rect x="110.89" y="106.45" width="37.99" height="37.99" rx="6.13" /><rect x="163.58" y="106.45" width="37.99" height="37.99" rx="6.13" /></g></svg>;
    default:
      return null;
  }
}

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
  xHandle: string | null;
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
  xHandle,
  socialLinks,
  friendCode,
}: LockScreenModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copying' | 'copied'>('idle');
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [resolvedAvatarDataUrl, setResolvedAvatarDataUrl] = useState<string | null>(null);
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

  // Preload avatar as data URL so html-to-image can embed it
  useEffect(() => {
    if (!isOpen) { setResolvedAvatarDataUrl(null); return; }

    const src = avatarUrl || (xHandle ? `https://unavatar.io/x/${xHandle}` : null);
    if (!src) return;
    if (src.startsWith('data:')) { setResolvedAvatarDataUrl(src); return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        setResolvedAvatarDataUrl(canvas.toDataURL('image/png'));
      }
    };
    img.onerror = () => setResolvedAvatarDataUrl(null);
    img.src = src;
  }, [isOpen, avatarUrl, xHandle]);

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
  }, [isOpen, isDesktop, pickerDone, generatePreview, enabledQrs, resolvedAvatarDataUrl]);

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
      setResolvedAvatarDataUrl(null);
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
            <h2 className="text-base font-bold text-[var(--theme-text-primary)]">Generate Lock Screen</h2>
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
                    <PlatformIcon platform={link.platform} />
                    <span className="text-sm text-[var(--theme-text-secondary)]">
                      {link.platform === 'friend' ? 'plan.wtf' : link.platform === 'x' ? `@${link.label.replace('@', '')}` : link.platform === 'telegram' ? link.label : 'LinkedIn'}
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
        avatarUrl={resolvedAvatarDataUrl}
        socialLinks={filteredLinks}
        screenWidth={screenDims.width}
        screenHeight={screenDims.height}
        logoDataUrl={logoDataUrl ?? undefined}
      />
    </>,
    document.body
  );
}

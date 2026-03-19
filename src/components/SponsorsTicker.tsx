'use client';

import { useEffect, useRef } from 'react';
import { SponsorEntry } from '@/lib/types';

const defaultSponsors: SponsorEntry[] = [
  {
    beforeText: 'Supported by ',
    linkText: 'Stand With Crypto',
    afterText: '. Join the Fight for Sensible Crypto Policy!',
    url: 'https://www.standwithcrypto.org/join/BtPHAB2fFkJP?utm_source=swc-hub&utm_medium=referral&utm_campaign=eth-denver-2026',
  },
];

interface SponsorsTickerProps {
  sponsors?: SponsorEntry[];
  /** A/B variant config: alternative sponsor list to show */
  variantSponsors?: SponsorEntry[];
  /** Called when the ticker becomes visible (for A/B impression tracking) */
  onImpression?: () => void;
  /** Called when a sponsor link is clicked (for A/B click tracking) */
  onSponsorClick?: (url: string) => void;
}

export function SponsorsTicker({ sponsors, variantSponsors, onImpression, onSponsorClick }: SponsorsTickerProps) {
  // If variant sponsors are provided (from A/B test), use them; otherwise fall back to normal flow
  const sponsorList = variantSponsors && variantSponsors.length > 0
    ? variantSponsors
    : sponsors && sponsors.length > 0
    ? sponsors
    : defaultSponsors;

  const tickerRef = useRef<HTMLDivElement>(null);
  const impressionTracked = useRef(false);

  // Track impression via IntersectionObserver
  useEffect(() => {
    const el = tickerRef.current;
    if (!el || !onImpression || impressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          onImpression();
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [onImpression]);

  const item = (
    <span className="inline-flex items-center">
      {sponsorList.map((s, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-6 text-[var(--theme-text-faint)]">&#10022;</span>}
          {s.beforeText} <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[var(--theme-text-muted)] underline-offset-2 hover:text-[var(--theme-text-primary)] hover:decoration-[var(--theme-text-secondary)] transition-colors"
            onClick={() => onSponsorClick?.(s.url)}
          >{s.linkText}</a>{s.afterText}
        </span>
      ))}
      <span className="mx-6 text-[var(--theme-text-faint)]">&#10022;</span>
    </span>
  );

  return (
    <div ref={tickerRef} className="w-full overflow-hidden border-b py-1.5" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-primary) 80%, transparent)', borderColor: 'color-mix(in srgb, var(--theme-border-secondary) 50%, transparent)' }}>
      <div className="sponsors-scroll inline-flex whitespace-nowrap text-xs text-[var(--theme-text-secondary)]">
        {item}{item}{item}{item}{item}{item}{item}{item}
      </div>
    </div>
  );
}

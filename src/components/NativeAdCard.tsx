'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Megaphone } from 'lucide-react';
import { NativeAd } from '@/lib/types';
import { trackAdClick, trackAdImpression } from '@/lib/analytics';
import { trackAdEvent } from '@/lib/ad-tracking';

interface NativeAdCardProps {
  ad: NativeAd;
  /** Which conference context this ad is shown in */
  conference?: string;
  /** Called when the ad becomes visible in the viewport */
  onImpression?: (adId: string) => void;
  /** Called when the user clicks the ad */
  onClick?: (adId: string) => void;
}

export default function NativeAdCard({ ad, conference, onImpression, onClick }: NativeAdCardProps) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const impressionTracked = useRef(false);

  // IntersectionObserver for impression tracking
  useEffect(() => {
    const el = cardRef.current;
    if (!el || impressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          // GA4 tracking (existing)
          trackAdImpression('native-ad');
          // Supabase per-ad tracking (new)
          trackAdEvent({
            ad_id: ad.id,
            ad_name: ad.title,
            placement: 'native-ad',
            event_type: 'impression',
            conference,
          });
          onImpression?.(ad.id);
          observer.disconnect();
        }
      },
      { threshold: 0.5 } // 50% visible
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ad.id, ad.title, conference, onImpression]);

  const handleClick = useCallback(() => {
    // GA4 tracking (existing)
    trackAdClick('native-ad', ad.link);
    // Supabase per-ad tracking (new)
    trackAdEvent({
      ad_id: ad.id,
      ad_name: ad.title,
      placement: 'native-ad',
      event_type: 'click',
      url: ad.link,
      conference,
    });
    onClick?.(ad.id);
  }, [ad.id, ad.title, ad.link, conference, onClick]);

  const isUnsold = !ad.imageUrl;

  return (
    <a
      ref={cardRef}
      href={ad.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
      onClick={handleClick}
    >
      <div className="flex gap-4 overflow-hidden rounded-lg bg-[var(--theme-bg-card)] border border-[var(--theme-border-primary)] border-l-[3px] border-l-[var(--theme-accent)] hover:bg-[var(--theme-bg-tertiary)] p-4 transition-colors">
        {isUnsold ? (
          <div className="w-[90px] h-[90px] flex-shrink-0 rounded-lg flex items-center justify-center bg-[var(--theme-bg-tertiary)]">
            <Megaphone className="w-8 h-8 text-[var(--theme-text-muted)]" />
          </div>
        ) : (
          <div className="w-[90px] h-[90px] flex-shrink-0 rounded-lg overflow-hidden bg-[var(--theme-bg-tertiary)]">
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-full h-full object-contain"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-[var(--theme-accent)] group-hover:brightness-110 transition-colors truncate block mb-1">
            {ad.title}
          </span>
          <p className="text-xs text-[var(--theme-text-secondary)] line-clamp-2 mb-2">{ad.description}</p>
          <span className="inline-block bg-[var(--theme-accent)] text-[var(--theme-accent-text)] px-3 py-1 rounded-full text-xs font-medium">
            {ad.badge || 'Sponsored'}
          </span>
        </div>
      </div>
    </a>
  );
}

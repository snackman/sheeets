'use client';

import { useEffect, useRef, useCallback } from 'react';
import { ExternalLink } from 'lucide-react';
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

  return (
    <a
      ref={cardRef}
      href={ad.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
      onClick={handleClick}
    >
      <div className="flex gap-4 overflow-hidden rounded-xl bg-purple-500/5 border border-purple-500/30 ring-1 ring-purple-500/40 hover:bg-purple-500/10 p-4 transition-colors">
        {ad.imageUrl && (
          <div className="w-[90px] h-[90px] flex-shrink-0 rounded-lg overflow-hidden bg-[var(--theme-bg-tertiary)]">
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-full h-full object-contain"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-[var(--theme-text-primary)] group-hover:text-purple-300 transition-colors truncate">
              {ad.title}
            </span>
            <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">
              {ad.badge || 'Sponsored'}
            </span>
          </div>
          <p className="text-xs text-[var(--theme-text-secondary)] line-clamp-2 mb-2">{ad.description}</p>
          <div className="flex items-center gap-1 text-xs text-purple-400">
            <ExternalLink className="w-3 h-3" />
            <span>Learn more</span>
          </div>
        </div>
      </div>
    </a>
  );
}

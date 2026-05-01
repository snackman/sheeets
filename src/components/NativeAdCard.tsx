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

  return (
    <a
      ref={cardRef}
      href={ad.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
      onClick={handleClick}
    >
      <div className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/20 hover:border-amber-500/30 px-4 py-3 transition-colors">
        {/* Left: image or Megaphone icon */}
        {ad.imageUrl ? (
          <div className="w-10 h-10 flex-shrink-0 rounded-lg overflow-hidden bg-[var(--theme-bg-tertiary)]">
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <Megaphone className="w-4 h-4 flex-shrink-0 text-amber-400" />
        )}

        {/* Middle: title + description */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-[var(--theme-text-primary)] truncate block">
            {ad.title}
          </span>
          {ad.description && (
            <span className="text-xs text-[var(--theme-text-secondary)] truncate block">
              {ad.description}
            </span>
          )}
        </div>

        {/* Right: CTA pill */}
        <span className="flex-shrink-0 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 px-3 py-1 rounded-full text-xs font-medium transition-colors">
          {ad.badge || 'Contact Us'}
        </span>
      </div>
    </a>
  );
}

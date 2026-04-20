'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { SidebarAd } from '@/lib/types';
import { trackAdClick, trackAdImpression } from '@/lib/analytics';
import { trackAdEvent } from '@/lib/ad-tracking';

interface SidebarAdColumnProps {
  ads: SidebarAd[];
  conference?: string;
}

function SidebarAdItem({ ad, conference }: { ad: SidebarAd; conference?: string }) {
  const adRef = useRef<HTMLAnchorElement>(null);
  const impressionTracked = useRef(false);

  // IntersectionObserver for impression tracking
  useEffect(() => {
    const el = adRef.current;
    if (!el || impressionTracked.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          // GA4 tracking
          trackAdImpression('sidebar');
          // Supabase per-ad tracking
          trackAdEvent({
            ad_id: ad.id,
            ad_name: ad.title,
            placement: 'sidebar',
            event_type: 'impression',
            conference,
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [ad.id, ad.title, conference]);

  const handleClick = useCallback(() => {
    // GA4 tracking
    trackAdClick('sidebar', ad.link);
    // Supabase per-ad tracking
    trackAdEvent({
      ad_id: ad.id,
      ad_name: ad.title,
      placement: 'sidebar',
      event_type: 'click',
      url: ad.link,
      conference,
    });
  }, [ad.id, ad.title, ad.link, conference]);

  return (
    <a
      ref={adRef}
      href={ad.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block group relative rounded-xl overflow-hidden border border-[var(--theme-border-primary)] hover:border-purple-500/40 transition-colors"
      onClick={handleClick}
      title={ad.title}
    >
      <img
        src={ad.imageUrl}
        alt={ad.title}
        className="w-full h-auto object-contain bg-[var(--theme-bg-tertiary)]"
      />
      <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-black/60 text-white/80 rounded-full backdrop-blur-sm">
        Sponsored
      </span>
    </a>
  );
}

export default function SidebarAdColumn({ ads, conference }: SidebarAdColumnProps) {
  if (!ads || ads.length === 0) return null;

  return (
    <aside className="w-[300px] shrink-0 hidden xl:flex xl:flex-col border-l border-[var(--theme-border-primary)] overflow-y-auto gap-4 p-4">
      {ads.map((ad) => (
        <SidebarAdItem key={ad.id} ad={ad} conference={conference} />
      ))}
    </aside>
  );
}

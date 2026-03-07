'use client';

import { ExternalLink } from 'lucide-react';
import { NativeAd } from '@/lib/types';

interface NativeAdCardProps {
  ad: NativeAd;
}

export default function NativeAdCard({ ad }: NativeAdCardProps) {
  return (
    <a
      href={ad.link}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <div className="flex gap-4 overflow-hidden rounded-xl bg-purple-500/5 border border-purple-500/30 ring-1 ring-purple-500/40 hover:bg-purple-500/10 p-4 transition-colors">
        {ad.imageUrl && (
          <div className="w-[120px] h-[90px] flex-shrink-0 rounded-lg overflow-hidden bg-violet-800">
            <img
              src={ad.imageUrl}
              alt={ad.title}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-white group-hover:text-purple-300 transition-colors truncate">
              {ad.title}
            </span>
            <span className="flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/30">
              {ad.badge || 'Sponsored'}
            </span>
          </div>
          <p className="text-xs text-violet-300 line-clamp-2 mb-2">{ad.description}</p>
          <div className="flex items-center gap-1 text-xs text-purple-400">
            <ExternalLink className="w-3 h-3" />
            <span>Learn more</span>
          </div>
        </div>
      </div>
    </a>
  );
}

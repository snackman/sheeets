'use client';

import { Calendar } from 'lucide-react';
import { ViewMode } from '@/lib/types';
import { ViewToggle } from './ViewToggle';

interface HeaderProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  itineraryCount: number;
}

export function Header({ viewMode, onViewChange, itineraryCount }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        {/* Left: Branding */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl" role="img" aria-label="pizza">
            🍕
          </span>
          <h1 className="text-lg sm:text-xl font-bold text-white truncate">
            ETHDenver 2025 Side Events
          </h1>
        </div>

        {/* Right: Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <ViewToggle viewMode={viewMode} onViewChange={onViewChange} />

          {/* Itinerary badge */}
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors text-sm cursor-pointer"
            aria-label={`Itinerary: ${itineraryCount} events`}
          >
            <Calendar className="w-4 h-4" />
            <span className="font-medium">{itineraryCount}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

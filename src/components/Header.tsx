'use client';

import { useState } from 'react';
import { Calendar, User } from 'lucide-react';
import { ViewMode } from '@/lib/types';
import { ViewToggle } from './ViewToggle';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal, UserMenu } from './AuthModal';

interface HeaderProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  itineraryCount: number;
  onItineraryToggle: () => void;
  isItineraryActive: boolean;
}

export function Header({
  viewMode,
  onViewChange,
  itineraryCount,
  onItineraryToggle,
  isItineraryActive,
}: HeaderProps) {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl" role="img" aria-label="calendar">
              📅
            </span>
            <h1 className="text-lg sm:text-xl font-bold text-white truncate">
              sheeets.xyz
            </h1>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Auth */}
            {!loading && (
              user ? (
                <UserMenu />
              ) : (
                <button
                  onClick={() => setShowAuth(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700 transition-colors text-sm cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              )
            )}

            <ViewToggle viewMode={viewMode} onViewChange={onViewChange} />

            {/* Itinerary filter toggle */}
            <button
              onClick={onItineraryToggle}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                isItineraryActive
                  ? 'bg-orange-500 text-white border-orange-500 hover:bg-orange-600 active:bg-orange-600'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700 active:text-slate-200 active:bg-slate-700'
              }`}
              aria-label={`Itinerary: ${itineraryCount} events`}
            >
              <Calendar className="w-4 h-4" />
              {itineraryCount > 0 && !isItineraryActive && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center bg-orange-500 text-white text-[10px] font-bold rounded-full px-1">
                  {itineraryCount}
                </span>
              )}
              {itineraryCount > 0 && isItineraryActive && (
                <span className="font-medium">{itineraryCount}</span>
              )}
              {itineraryCount === 0 && (
                <span className="font-medium">{itineraryCount}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}

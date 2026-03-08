'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Calendar, User } from 'lucide-react';
import { trackAuthPrompt } from '@/lib/analytics';
import { ViewMode, ETHDenverEvent } from '@/lib/types';
import { ViewToggle } from './ViewToggle';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal, UserMenu } from './AuthModal';

interface HeaderProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  itineraryCount: number;
  onItineraryToggle: () => void;
  isItineraryActive: boolean;
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  onOpenFriends: () => void;
  onSubmitEvent?: () => void;
  refreshFriends?: () => Promise<void>;
}

export function Header({
  viewMode,
  onViewChange,
  itineraryCount,
  onItineraryToggle,
  isItineraryActive,
  events,
  itinerary,
  onOpenFriends,
  onSubmitEvent,
  refreshFriends,
}: HeaderProps) {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      <header className="sticky top-0 shrink-0 z-50 bg-stone-950/95 backdrop-blur-sm border-b border-stone-800">
        <div className="px-2 sm:px-4 py-3 flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center min-w-0">
            <Image src="/logo.png" alt="plan.wtf" width={130} height={36} className="invert" priority />
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-3 shrink-0">
            <ViewToggle viewMode={viewMode} onViewChange={onViewChange} />

            {/* Itinerary filter toggle */}
            <button
              onClick={() => {
                if (!user) {
                  trackAuthPrompt('itinerary_button');
                  setShowAuth(true);
                  return;
                }
                onItineraryToggle();
              }}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                isItineraryActive
                  ? 'bg-amber-500 text-stone-900 border-amber-500 hover:bg-amber-600 active:bg-amber-600'
                  : 'border-stone-700 bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800'
              }`}
              aria-label={`Itinerary: ${itineraryCount} events`}
            >
              <Calendar className="w-4 h-4" />
              {itineraryCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 ${
                  isItineraryActive
                    ? 'bg-stone-900 text-stone-400'
                    : 'bg-amber-500 text-stone-900'
                }`}>
                  {itineraryCount}
                </span>
              )}
            </button>

            {/* Auth / Profile — far right */}
            {!loading && (
              user ? (
                <UserMenu events={events} itinerary={itinerary} onOpenFriends={onOpenFriends} onSubmitEvent={onSubmitEvent} externalRefreshFriends={refreshFriends} />
              ) : (
                <button
                  onClick={() => { trackAuthPrompt('sign_in_button'); setShowAuth(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-700 bg-stone-900 text-stone-400 hover:text-stone-200 hover:bg-stone-800 active:text-stone-200 active:bg-stone-800 transition-colors text-sm cursor-pointer"
                >
                  <User className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              )
            )}
          </div>
        </div>
      </header>

      <AuthModal isOpen={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}

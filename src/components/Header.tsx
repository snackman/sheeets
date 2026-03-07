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
      <header className="sticky top-0 shrink-0 z-50 bg-blue-950/95 backdrop-blur-sm border-b border-blue-800">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 py-3 flex items-center justify-between gap-4">
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
                  ? 'bg-yellow-500 text-white border-yellow-500 hover:bg-yellow-600 active:bg-yellow-600'
                  : 'border-blue-700 bg-blue-900 text-blue-400 hover:text-blue-200 hover:bg-blue-800 active:text-blue-200 active:bg-blue-800'
              }`}
              aria-label={`Itinerary: ${itineraryCount} events`}
            >
              <Calendar className="w-4 h-4" />
              {itineraryCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 ${
                  isItineraryActive
                    ? 'bg-blue-900 text-blue-400'
                    : 'bg-yellow-500 text-white'
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-700 bg-blue-900 text-blue-400 hover:text-blue-200 hover:bg-blue-800 active:text-blue-200 active:bg-blue-800 transition-colors text-sm cursor-pointer"
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

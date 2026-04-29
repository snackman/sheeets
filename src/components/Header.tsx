'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Calendar, User, MapPin, Loader2 } from 'lucide-react';
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
  hasNearbyLiveEvents?: boolean;
  onBulkCheckIn?: () => void;
  checkInLoading?: boolean;
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
  hasNearbyLiveEvents,
  onBulkCheckIn,
  checkInLoading,
}: HeaderProps) {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      <header className="sticky top-0 shrink-0 z-50 backdrop-blur-sm border-b border-[var(--theme-border-secondary)]" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-bg-primary) 95%, transparent)' }}>
        <div className="px-2 sm:px-4 py-3 flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center min-w-0">
            <a href="/"><Image src="/logo.png" alt="plan.wtf" width={130} height={36} style={{ filter: 'var(--theme-logo-filter)' }} priority /></a>
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
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)] border-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-hover)]'
                  : 'border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)]'
              }`}
              aria-label={`Itinerary: ${itineraryCount} events`}
            >
              <Calendar className="w-4 h-4" />
              {itineraryCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold rounded-full px-1 border border-[var(--theme-accent)] ${
                  isItineraryActive
                    ? 'bg-[var(--theme-bg-secondary)] text-[var(--theme-accent)]'
                    : 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                }`}>
                  {itineraryCount}
                </span>
              )}
            </button>

            {/* Proximity check-in indicator */}
            {hasNearbyLiveEvents && user && (
              <button
                onClick={onBulkCheckIn}
                disabled={checkInLoading}
                className="p-1.5 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors cursor-pointer animate-pulse"
                aria-label="Check in to nearby events"
                title="Check in to nearby events"
              >
                {checkInLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MapPin className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Auth / Profile — far right */}
            {!loading && (
              user ? (
                <UserMenu events={events} itinerary={itinerary} onOpenFriends={onOpenFriends} onSubmitEvent={onSubmitEvent} externalRefreshFriends={refreshFriends} />
              ) : (
                <button
                  onClick={() => { trackAuthPrompt('sign_in_button'); setShowAuth(true); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] transition-colors text-sm cursor-pointer"
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

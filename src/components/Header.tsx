'use client';

import { useState } from 'react';
import Image from 'next/image';
import { User, MapPin, Loader2 } from 'lucide-react';
import { trackAuthPrompt } from '@/lib/analytics';
import { ViewMode, ETHDenverEvent } from '@/lib/types';
import { ViewToggle } from './ViewToggle';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal, UserMenu } from './AuthModal';

interface HeaderProps {
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  onOpenFriends: () => void;
  onSubmitEvent?: () => void;
  refreshFriends?: () => Promise<void>;
  activeConference?: string;
  hasNearbyLiveEvents?: boolean;
  onBulkCheckIn?: () => void;
  checkInLoading?: boolean;
  children?: React.ReactNode;
}

export function Header({
  viewMode,
  onViewChange,
  events,
  itinerary,
  onOpenFriends,
  onSubmitEvent,
  refreshFriends,
  activeConference,
  hasNearbyLiveEvents,
  onBulkCheckIn,
  checkInLoading,
  children,
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

            {children}

            {/* Auth / Profile — far right */}
            {!loading && (
              user ? (
                <UserMenu events={events} itinerary={itinerary} onOpenFriends={onOpenFriends} onSubmitEvent={onSubmitEvent} externalRefreshFriends={refreshFriends} activeConference={activeConference} />
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

'use client';

import { memo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { User, MapPin, Loader2, CircleHelp } from 'lucide-react';
import { trackAuthPrompt } from '@/lib/analytics';
import { ETHDenverEvent } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { AuthModal, UserMenu } from './AuthModal';

interface HeaderProps {
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  onOpenFriends: () => void;
  onSubmitEvent?: () => void;
  /** Reopen the first-run intro. */
  onOpenIntro?: () => void;
  refreshFriends?: () => Promise<void>;
  activeConference?: string;
  hasNearbyLiveEvents?: boolean;
  onBulkCheckIn?: () => void;
  checkInLoading?: boolean;
}

export const Header = memo(function Header({
  events,
  itinerary,
  onOpenFriends,
  onSubmitEvent,
  onOpenIntro,
  refreshFriends,
  activeConference,
  hasNearbyLiveEvents,
  onBulkCheckIn,
  checkInLoading,
}: HeaderProps) {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);

  return (
    <>
      <header className="sticky top-0 shrink-0 z-[var(--z-header)] backdrop-blur-sm border-b border-[var(--theme-header-border)]" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-header-bg) 95%, transparent)' }}>
        <div className="px-2 sm:px-4 py-3 flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center min-w-0">
            <Link href="/" style={{ marginTop: '-4px' }}><Image src="/logo.png" alt="plan.wtf" width={130} height={36} style={{ filter: 'var(--theme-header-logo-filter)' }} priority /></Link>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-3 shrink-0">
            {onOpenIntro && (
              <button
                type="button"
                onClick={onOpenIntro}
                aria-label="How plan.wtf works"
                title="How plan.wtf works"
                className="inline-flex items-center justify-center min-h-9 min-w-9 tap:min-h-11 tap:min-w-11 rounded-lg text-[var(--theme-header-text)] hover:text-[var(--theme-header-text-hover)] transition-colors cursor-pointer"
              >
                <CircleHelp className="w-5 h-5" aria-hidden="true" />
              </button>
            )}

            {/* Proximity check-in indicator */}
            {hasNearbyLiveEvents && user && (
              <button
                onClick={onBulkCheckIn}
                disabled={checkInLoading}
                className="p-1.5 tap:min-h-11 tap:min-w-11 inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors cursor-pointer animate-pulse"
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
                <UserMenu events={events} itinerary={itinerary} onOpenFriends={onOpenFriends} onSubmitEvent={onSubmitEvent} externalRefreshFriends={refreshFriends} activeConference={activeConference} />
              ) : (
                <button
                  onClick={() => { trackAuthPrompt('sign_in_button'); setShowAuth(true); }}
                  aria-label="Sign in"
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 tap:min-h-11 tap:min-w-11 rounded-lg border border-[var(--theme-header-control-border)] text-[var(--theme-header-text)] hover:text-[var(--theme-header-text-hover)] active:text-[var(--theme-header-text-hover)] transition-colors text-sm cursor-pointer"
                  style={{ backgroundColor: 'var(--theme-header-control-bg)' }}
                >
                  <User className="w-3.5 h-3.5" aria-hidden="true" />
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
});

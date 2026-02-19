'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Navigation, Car, X, MapPinCheck, MapPinOff, Loader2, LogIn, Copy, Check } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

function buildNavUrls(address: string, lat?: number, lng?: number) {
  const encoded = encodeURIComponent(address);
  const dest = address ? encoded : (lat != null ? `${lat},${lng}` : encoded);

  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${dest}`,
    uber: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encoded}${lat != null ? `&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}` : ''}`,
    lyft: `lyft://ridetype?id=lyft&destination[address]=${encoded}${lat != null ? `&destination[latitude]=${lat}&destination[longitude]=${lng}` : ''}`,
  };
}

interface NavigationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  lat?: number;
  lng?: number;
  eventId?: string;
  eventName?: string;
  isPrivatePin?: boolean;
}

function NavigationSheet({ isOpen, onClose, address, lat, lng, eventId, eventName, isPrivatePin }: NavigationSheetProps) {
  const { user } = useAuth();
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInResult, setCheckInResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeCheckIn, setActiveCheckIn] = useState<{ event_id: string; id: string } | null>(null);
  const [loadingActiveCheckIn, setLoadingActiveCheckIn] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (!isOpen) {
      setCheckInResult(null);
      setCheckInLoading(false);
      setCopied(false);
    }
  }, [isOpen]);

  // For private pins: check if user has an active check-in elsewhere
  useEffect(() => {
    if (!isOpen || !isPrivatePin || !user) {
      setActiveCheckIn(null);
      return;
    }

    async function fetchActiveCheckIn() {
      setLoadingActiveCheckIn(true);
      try {
        const { data, error } = await supabase
          .from('check_ins')
          .select('id, event_id')
          .eq('user_id', user!.id)
          .is('checked_out_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          setActiveCheckIn(data);
        } else {
          setActiveCheckIn(null);
        }
      } catch {
        setActiveCheckIn(null);
      }
      setLoadingActiveCheckIn(false);
    }

    fetchActiveCheckIn();
  }, [isOpen, isPrivatePin, user]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleCheckIn = useCallback(async () => {
    if (!user || !eventId) return;
    setCheckInLoading(true);
    setCheckInResult(null);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
        })
      );

      const { latitude: uLat, longitude: uLng } = pos.coords;

      const { error } = await supabase.from('check_ins').upsert(
        {
          user_id: user.id,
          event_id: eventId,
          lat: uLat,
          lng: uLng,
        },
        { onConflict: 'user_id,event_id' }
      );

      if (error) throw error;

      setCheckInResult({
        ok: true,
        message: eventName ? `Checked in at ${eventName}!` : 'Checked in!',
      });
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationPositionError
          ? 'Location access denied'
          : err instanceof Error
            ? err.message
            : 'Check-in failed';
      setCheckInResult({ ok: false, message: msg });
    }

    setCheckInLoading(false);
  }, [user, eventId, eventName]);

  const handleCheckOut = useCallback(async () => {
    if (!user || !activeCheckIn) return;
    setCheckInLoading(true);
    setCheckInResult(null);

    try {
      const { error } = await supabase
        .from('check_ins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('id', activeCheckIn.id);

      if (error) throw error;

      setCheckInResult({ ok: true, message: 'Checked out!' });
      setActiveCheckIn(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Check-out failed';
      setCheckInResult({ ok: false, message: msg });
    }

    setCheckInLoading(false);
  }, [user, activeCheckIn]);

  const handleCopyAddress = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: some browsers block clipboard in non-secure contexts
    }
  }, [address]);

  if (!isOpen) return null;

  const urls = buildNavUrls(address, lat, lng);

  const options = [
    { label: 'Google Maps', url: urls.google, icon: <Navigation className="w-5 h-5" />, color: 'text-blue-400' },
    { label: 'Lyft', url: urls.lyft, icon: <Car className="w-5 h-5" />, color: 'text-pink-400' },
    { label: 'Uber', url: urls.uber, icon: <Car className="w-5 h-5" />, color: 'text-white' },
  ];

  // Determine which check-in/check-out button to show
  const showCheckIn = !!eventId && !!user;
  const showCheckOut = !!isPrivatePin && !!user && !!activeCheckIn && !loadingActiveCheckIn;
  const showSignInHint = (!!eventId || !!isPrivatePin) && !user;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-slate-800 border-t border-slate-700 rounded-t-2xl p-4 pb-8">
        <p className="text-slate-400 text-xs mb-3 truncate px-1">{address}</p>
        <div className="space-y-1">
          <button
            onClick={handleCopyAddress}
            className="flex items-center gap-3 w-full px-4 py-3 text-white hover:bg-slate-700/50 transition-colors rounded-lg cursor-pointer"
          >
            <span className="text-slate-300">
              {copied ? <Check className="w-5 h-5 text-green-400" /> : <Copy className="w-5 h-5" />}
            </span>
            <span className="text-sm font-medium">{copied ? 'Copied!' : 'Copy Address'}</span>
          </button>
          {options.map((opt) => (
            <a
              key={opt.label}
              href={opt.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-center gap-3 w-full px-4 py-3 text-white hover:bg-slate-700/50 transition-colors rounded-lg"
            >
              <span className={opt.color}>{opt.icon}</span>
              <span className="text-sm font-medium">{opt.label}</span>
            </a>
          ))}
        </div>

        {/* Check In button (for events and public POIs) */}
        {showCheckIn && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <button
              onClick={handleCheckIn}
              disabled={checkInLoading}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {checkInLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking in...
                </>
              ) : (
                <>
                  <MapPinCheck className="w-4 h-4" />
                  Check In
                </>
              )}
            </button>
          </div>
        )}

        {/* Check Out button (for private pins when user is checked in elsewhere) */}
        {showCheckOut && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <button
              onClick={handleCheckOut}
              disabled={checkInLoading}
              className="flex items-center justify-center gap-2 w-full px-4 py-3 border border-slate-600 hover:border-red-500/50 hover:bg-red-500/10 text-slate-300 hover:text-red-400 rounded-lg text-sm font-medium transition-colors cursor-pointer"
            >
              {checkInLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking out...
                </>
              ) : (
                <>
                  <MapPinOff className="w-4 h-4" />
                  Check Out
                </>
              )}
            </button>
          </div>
        )}

        {/* Loading active check-in state for private pins */}
        {isPrivatePin && user && loadingActiveCheckIn && (
          <div className="mt-3 pt-3 border-t border-slate-700 flex items-center justify-center gap-2 text-slate-500 text-sm py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}

        {/* Sign-in hint */}
        {showSignInHint && (
          <div className="mt-3 pt-3 border-t border-slate-700">
            <p className="flex items-center justify-center gap-2 text-slate-500 text-xs py-1">
              <LogIn className="w-3.5 h-3.5" />
              Sign in to check in
            </p>
          </div>
        )}

        {/* Check-in/out result message */}
        {checkInResult && (
          <div
            className={`mt-2 flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${
              checkInResult.ok
                ? 'bg-green-900/40 text-green-300'
                : 'bg-slate-700/60 text-slate-300'
            }`}
          >
            {checkInResult.ok ? (
              <MapPinCheck className="w-4 h-4 shrink-0" />
            ) : (
              <X className="w-4 h-4 shrink-0" />
            )}
            <span>{checkInResult.message}</span>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-2 py-3 text-slate-400 hover:text-white text-sm font-medium transition-colors rounded-lg cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </>,
    document.body
  );
}

interface AddressLinkProps {
  address: string;
  navAddress?: string;
  lat?: number;
  lng?: number;
  className?: string;
  children: React.ReactNode;
  eventId?: string;
  eventName?: string;
  isPrivatePin?: boolean;
}

export function AddressLink({ address, navAddress, lat, lng, className, children, eventId, eventName, isPrivatePin }: AddressLinkProps) {
  const [open, setOpen] = useState(false);
  const destination = navAddress || address;

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Desktop: open Google Maps directly
    const isDesktop = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (isDesktop) {
      const encoded = encodeURIComponent(destination);
      const dest = destination ? encoded : (lat != null ? `${lat},${lng}` : encoded);
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, '_blank');
      return;
    }

    // Mobile: show navigation sheet with all options
    setOpen(true);
  }, [destination, lat, lng]);

  return (
    <>
      <button onClick={handleClick} className={`${className ?? ''} cursor-pointer text-left`}>
        {children}
      </button>
      <NavigationSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        address={destination}
        lat={lat}
        lng={lng}
        eventId={eventId}
        eventName={eventName}
        isPrivatePin={isPrivatePin}
      />
    </>
  );
}

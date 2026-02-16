'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, LogOut, User, MapPin, Check, Loader2, Users, Search, UserPlus, Clock, XCircle, Settings } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { trackAuthSuccess, trackSignOut } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { distanceMeters } from '@/lib/geo';
import { passesNowFilter } from '@/lib/filters';
import { useProfile } from '@/hooks/useProfile';
import { useFriends } from '@/hooks/useFriends';
import { useFriendRequests } from '@/hooks/useFriendRequests';
import type { ETHDenverEvent, UserSearchResult, FriendRequest } from '@/lib/types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Step = 'email' | 'code' | 'success';

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { signIn, verifyOtp } = useAuth();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const reset = useCallback(() => {
    setStep('email');
    setEmail('');
    setCode(['', '', '', '', '', '']);
    setError('');
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error } = await signIn(email);
    setLoading(false);

    if (error) {
      setError(error);
    } else {
      setStep('code');
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits entered
    if (digit && index === 5) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        submitCode(fullCode);
      }
    }
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split('');
      setCode(newCode);
      inputRefs.current[5]?.focus();
      submitCode(pasted);
    }
  };

  const submitCode = async (fullCode: string) => {
    setError('');
    setLoading(true);
    const { error } = await verifyOtp(email, fullCode);
    setLoading(false);

    if (error) {
      setError(error);
      setCode(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } else {
      trackAuthSuccess();
      setStep('success');
      setTimeout(() => handleClose(), 1500);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/50" onClick={handleClose} />
      <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
            <h2 className="text-base font-bold text-white">
              {step === 'email' && 'Sign in'}
              {step === 'code' && 'Enter code'}
              {step === 'success' && 'Signed in!'}
            </h2>
            <button onClick={handleClose} className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-5">
            {step === 'email' && (
              <form onSubmit={handleEmailSubmit}>
                <p className="text-slate-400 text-sm mb-4">
                  Enter your email to save your itinerary across devices.
                </p>
                <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 focus-within:border-orange-500 transition-colors">
                  <Mail className="w-4 h-4 text-slate-500 shrink-0" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
                    required
                    autoFocus
                  />
                </div>
                {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-4 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors cursor-pointer"
                >
                  {loading ? 'Sending...' : 'Send code'}
                </button>
              </form>
            )}

            {step === 'code' && (
              <div>
                <p className="text-slate-400 text-sm mb-4">
                  We sent a 6-digit code to <span className="text-white font-medium">{email}</span>
                </p>
                <div className="flex justify-center gap-2" onPaste={handlePaste}>
                  {code.map((digit, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleCodeChange(i, e.target.value)}
                      onKeyDown={(e) => handleCodeKeyDown(i, e)}
                      className="w-10 h-12 bg-slate-900 border border-slate-600 rounded-lg text-white text-center text-lg font-bold outline-none focus:border-orange-500 transition-colors"
                    />
                  ))}
                </div>
                {error && <p className="text-red-400 text-xs mt-3 text-center">{error}</p>}
                {loading && <p className="text-orange-400 text-xs mt-3 text-center">Verifying...</p>}
                <button
                  onClick={() => { setStep('email'); setError(''); }}
                  className="w-full mt-4 text-slate-400 hover:text-slate-300 text-xs text-center cursor-pointer"
                >
                  Use a different email
                </button>
              </div>
            )}

            {step === 'success' && (
              <div className="text-center py-4">
                <div className="text-3xl mb-2">✓</div>
                <p className="text-white font-medium">You&apos;re signed in!</p>
                <p className="text-slate-400 text-sm mt-1">Your itinerary will sync across devices.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Search result row ---
function SearchResultRow({
  result,
  onSend,
  onAccept,
  sending,
}: {
  result: UserSearchResult;
  onSend: (userId: string) => void;
  onAccept: (userId: string) => void;
  sending: string | null;
}) {
  const displayName = result.display_name || result.email || 'Anonymous';
  const secondary = result.x_handle
    ? `@${result.x_handle}`
    : result.email
      ? result.email
      : null;

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
        <span className="text-sm font-medium text-slate-300">
          {(result.display_name || result.email || '?')[0].toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{displayName}</p>
        {secondary && result.display_name && (
          <p className="text-xs text-slate-500 truncate">{secondary}</p>
        )}
      </div>
      {result.request_status === 'pending_outgoing' ? (
        <span className="flex items-center gap-1 text-xs text-slate-500 bg-slate-700 px-2.5 py-1.5 rounded-lg">
          <Clock className="w-3 h-3" />
          Pending
        </span>
      ) : result.request_status === 'pending_incoming' ? (
        <button
          onClick={() => onAccept(result.user_id)}
          disabled={sending === result.user_id}
          className="flex items-center gap-1 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          <Check className="w-3 h-3" />
          Accept
        </button>
      ) : (
        <button
          onClick={() => onSend(result.user_id)}
          disabled={sending === result.user_id}
          className="flex items-center gap-1 text-xs font-medium bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          {sending === result.user_id ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <UserPlus className="w-3 h-3" />
          )}
          Add Friend
        </button>
      )}
    </div>
  );
}

// --- Incoming request row ---
function IncomingRequestRow({
  request,
  onAccept,
  onReject,
  responding,
}: {
  request: FriendRequest;
  onAccept: () => void;
  onReject: () => void;
  responding: boolean;
}) {
  const profile = request.sender_profile;
  const displayName = profile?.display_name || profile?.email || 'Anonymous';

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
        <span className="text-sm font-medium text-slate-300">
          {(profile?.display_name || profile?.email || '?')[0].toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{displayName}</p>
        {profile?.display_name && profile?.email && (
          <p className="text-xs text-slate-500 truncate">{profile.email}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onAccept}
          disabled={responding}
          className="flex items-center gap-1 text-xs font-medium bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          <Check className="w-3 h-3" />
          Accept
        </button>
        <button
          onClick={onReject}
          disabled={responding}
          className="flex items-center gap-1 text-xs font-medium border border-slate-600 hover:border-red-500/50 hover:bg-red-500/10 text-slate-400 hover:text-red-400 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// --- Outgoing request row ---
function OutgoingRequestRow({
  request,
  onCancel,
  cancelling,
}: {
  request: FriendRequest;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const profile = request.receiver_profile;
  const displayName = profile?.display_name || profile?.email || 'Anonymous';

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
        <span className="text-sm font-medium text-slate-300">
          {(profile?.display_name || profile?.email || '?')[0].toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{displayName}</p>
        {profile?.display_name && profile?.email && (
          <p className="text-xs text-slate-500 truncate">{profile.email}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-slate-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Pending
        </span>
        <button
          onClick={onCancel}
          disabled={cancelling}
          className="p-1 text-slate-500 hover:text-red-400 disabled:opacity-50 transition-colors cursor-pointer"
          title="Cancel request"
        >
          <XCircle className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

interface UserMenuProps {
  events: ETHDenverEvent[];
  itinerary: Set<string>;
  onOpenFriends: () => void;
  pendingIncomingCount?: number;
}

export function UserMenu({ events, itinerary, onOpenFriends, pendingIncomingCount: externalCount }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const { profile, updateProfile } = useProfile();
  const { friendCount, refreshFriends } = useFriends();
  const {
    incomingRequests,
    outgoingRequests,
    pendingIncomingCount,
    searchResults,
    searchLoading,
    searchUsers,
    sendRequest,
    respondToRequest,
    cancelRequest,
  } = useFriendRequests({ refreshFriends });

  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  // Profile form state
  const [displayName, setDisplayName] = useState('');
  const [xHandle, setXHandle] = useState('');
  const [rsvpName, setRsvpName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  // Friend search state
  const [searchQuery, setSearchQuery] = useState('');
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [showOutgoing, setShowOutgoing] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const badgeCount = externalCount ?? pendingIncomingCount;

  // Sync form state when profile loads
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setXHandle(profile.x_handle ?? '');
      setRsvpName(profile.rsvp_name ?? '');
    }
  }, [profile]);

  // Debounced search
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!searchQuery.trim()) {
      return;
    }
    searchTimeout.current = setTimeout(() => {
      searchUsers(searchQuery);
    }, 400);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [searchQuery, searchUsers]);

  if (!user) return null;

  async function handleSaveProfile() {
    setSaving(true);
    await updateProfile({
      display_name: displayName.trim() || null,
      x_handle: xHandle.trim() || null,
      rsvp_name: rsvpName.trim() || null,
    });
    setSaving(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }

  async function handleSendRequest(receiverId: string) {
    setSendingTo(receiverId);
    await sendRequest(receiverId);
    setSendingTo(null);
  }

  async function handleAcceptFromSearch(userId: string) {
    // Find the incoming request for this user
    const req = incomingRequests.find((r) => r.sender_id === userId);
    if (req) {
      setSendingTo(userId);
      await respondToRequest(req.id, true);
      setSendingTo(null);
      // Re-search to update results
      if (searchQuery.trim()) searchUsers(searchQuery);
    } else {
      // Fallback: send a request (will auto-accept via RPC if reverse exists)
      await handleSendRequest(userId);
    }
  }

  async function handleRespondToRequest(requestId: string, accept: boolean) {
    setRespondingTo(requestId);
    await respondToRequest(requestId, accept);
    setRespondingTo(null);
  }

  async function handleCancelRequest(requestId: string) {
    setCancellingId(requestId);
    await cancelRequest(requestId);
    setCancellingId(null);
  }

  async function handleCheckIn() {
    setChecking(true);
    setCheckResult(null);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
        })
      );

      const { latitude: uLat, longitude: uLng } = pos.coords;
      const now = new Date();

      const nearby = events.filter((e) => {
        if (!itinerary.has(e.id)) return false;
        if (!e.lat || !e.lng) return false;
        if (!passesNowFilter(e, now)) return false;
        return distanceMeters(uLat, uLng, e.lat, e.lng) <= 150;
      });

      if (nearby.length === 0) {
        setCheckResult({
          ok: false,
          message: 'No active itinerary events nearby',
        });
        setChecking(false);
        return;
      }

      const rows = nearby.map((e) => ({
        user_id: user!.id,
        event_id: e.id,
        lat: uLat,
        lng: uLng,
      }));

      const { error } = await supabase.from('check_ins').upsert(rows, {
        onConflict: 'user_id,event_id',
      });

      if (error) throw error;

      const names = nearby.map((e) => e.name).join(', ');
      setCheckResult({
        ok: true,
        message: `Checked in at ${names}!`,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof GeolocationPositionError
          ? 'Location access denied'
          : err instanceof Error
            ? err.message
            : 'Check-in failed';
      setCheckResult({ ok: false, message: msg });
    }

    setChecking(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
        title="Settings"
      >
        <Settings className="w-4 h-4" />
        {badgeCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center text-[9px] font-bold rounded-full bg-orange-500 text-white px-0.5">
            {badgeCount}
          </span>
        )}
      </button>

      {open && createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={() => {
            setOpen(false);
            setCheckResult(null);
            setSearchQuery('');
          }}>
            <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <h2 className="text-base font-bold text-white">Profile</h2>
                <button onClick={() => {
                  setOpen(false);
                  setCheckResult(null);
                  setSearchQuery('');
                }} className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="max-h-[80vh] overflow-y-auto px-4 py-5 space-y-4">
                {/* Email */}
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Email</p>
                  <p className="text-sm text-white mt-0.5">{user.email}</p>
                </div>

                {/* Profile Fields */}
                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">Display Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">X (Twitter)</label>
                    <div className="flex items-center bg-slate-900 border border-slate-600 rounded-lg focus-within:border-orange-500">
                      <span className="text-slate-500 text-sm pl-3 select-none">@</span>
                      <input
                        type="text"
                        value={xHandle}
                        onChange={(e) => setXHandle(e.target.value.replace(/^@/, ''))}
                        placeholder="handle"
                        className="flex-1 bg-transparent text-white text-sm px-2 py-2 focus:outline-none placeholder:text-slate-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500 uppercase tracking-wide block mb-1">RSVP Name</label>
                    <input
                      type="text"
                      value={rsvpName}
                      onChange={(e) => setRsvpName(e.target.value)}
                      placeholder="Name for event RSVPs"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg text-white text-sm px-3 py-2 focus:border-orange-500 focus:outline-none placeholder:text-slate-500"
                    />
                  </div>

                  <button
                    onClick={handleSaveProfile}
                    disabled={saving}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    {saving ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
                  </button>
                </div>

                {/* Check In */}
                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <button
                    onClick={handleCheckIn}
                    disabled={checking}
                    className="w-full flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors cursor-pointer"
                  >
                    {checking ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Checking in...
                      </span>
                    ) : (
                      <>
                        <span className="flex items-center gap-2">
                          <MapPin className="w-4 h-4" />
                          Check In
                        </span>
                        <span className="text-xs font-normal text-green-200/70">Checks into nearest live RSVP'd event</span>
                      </>
                    )}
                  </button>

                  {checkResult && (
                    <div
                      className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 ${
                        checkResult.ok
                          ? 'bg-green-900/40 text-green-300'
                          : 'bg-slate-700/60 text-slate-300'
                      }`}
                    >
                      {checkResult.ok ? (
                        <Check className="w-4 h-4 mt-0.5 shrink-0" />
                      ) : (
                        <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                      )}
                      <span>{checkResult.message}</span>
                    </div>
                  )}
                </div>

                {/* Friends */}
                <div className="border-t border-slate-700 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-slate-400" />
                      <p className="text-xs text-slate-500 uppercase tracking-wide">Friends</p>
                    </div>
                    <p className="text-xs text-slate-500">
                      {friendCount > 0 && `${friendCount} friend${friendCount !== 1 ? 's' : ''}`}
                    </p>
                  </div>

                  {/* View Friends button */}
                  {friendCount > 0 && (
                    <button
                      onClick={() => { setOpen(false); onOpenFriends(); }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-slate-700 hover:bg-slate-600 text-white transition-colors cursor-pointer"
                    >
                      <Users className="w-4 h-4" />
                      View Friends ({friendCount})
                    </button>
                  )}

                  {/* Incoming friend requests */}
                  {incomingRequests.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-orange-400 uppercase tracking-wide">
                        Friend Requests ({incomingRequests.length})
                      </p>
                      <div className="space-y-0.5">
                        {incomingRequests.map((req) => (
                          <IncomingRequestRow
                            key={req.id}
                            request={req}
                            onAccept={() => handleRespondToRequest(req.id, true)}
                            onReject={() => handleRespondToRequest(req.id, false)}
                            responding={respondingTo === req.id}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search for friends */}
                  <div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 focus-within:border-orange-500 transition-colors">
                    <Search className="w-4 h-4 text-slate-500 shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by email, name, or @twitter..."
                      className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
                    />
                    {searchLoading && <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" />}
                  </div>

                  {/* Search results */}
                  {searchQuery.trim() && searchResults.length > 0 && (
                    <div className="space-y-0.5">
                      {searchResults.map((result) => (
                        <SearchResultRow
                          key={result.user_id}
                          result={result}
                          onSend={handleSendRequest}
                          onAccept={handleAcceptFromSearch}
                          sending={sendingTo}
                        />
                      ))}
                    </div>
                  )}

                  {searchQuery.trim() && !searchLoading && searchResults.length === 0 && (
                    <p className="text-xs text-slate-500 text-center py-2">
                      No users found
                    </p>
                  )}

                  {/* Outgoing requests (collapsible) */}
                  {outgoingRequests.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowOutgoing(!showOutgoing)}
                        className="text-xs text-slate-500 hover:text-slate-400 transition-colors cursor-pointer"
                      >
                        {showOutgoing ? 'Hide' : 'Show'} sent requests ({outgoingRequests.length})
                      </button>
                      {showOutgoing && (
                        <div className="space-y-0.5 mt-1">
                          {outgoingRequests.map((req) => (
                            <OutgoingRequestRow
                              key={req.id}
                              request={req}
                              onCancel={() => handleCancelRequest(req.id)}
                              cancelling={cancellingId === req.id}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {friendCount === 0 && incomingRequests.length === 0 && !searchQuery.trim() && (
                    <p className="text-xs text-slate-500">
                      Search by email, name, or @handle to find friends
                    </p>
                  )}
                </div>

                {/* Sign Out */}
                <div className="border-t border-slate-700 pt-4">
                  <button
                    onClick={() => {
                      trackSignOut();
                      signOut();
                      setOpen(false);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-600 hover:border-red-500/50 hover:bg-red-500/10 text-slate-400 hover:text-red-400 rounded-lg text-sm transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
      )}
    </>
  );
}

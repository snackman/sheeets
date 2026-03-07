'use client';

import { useState } from 'react';
import { X, Trash2, ExternalLink, Users, ChevronRight, Mail } from 'lucide-react';
import type { Friend } from '@/lib/types';

interface FriendsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  friends: Friend[];
  onRemoveFriend: (userId: string) => void;
}

function FriendCard({
  friend,
  onRemove,
}: {
  friend: Friend;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const displayName = friend.display_name || friend.email || 'Anonymous';
  const hasSocials = friend.x_handle || friend.rsvp_name;

  return (
    <div className="bg-violet-900 rounded-lg border border-violet-800 overflow-hidden">
      {/* Tappable header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left cursor-pointer hover:bg-slate-750 transition-colors"
      >
        {/* Avatar circle with initial */}
        <div className="w-8 h-8 rounded-full bg-violet-800 flex items-center justify-center shrink-0">
          <span className="text-sm font-medium text-violet-200">
            {(friend.display_name || friend.email || '?')[0].toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{displayName}</p>
          {friend.display_name && friend.email && (
            <p className="text-xs text-violet-400 truncate">{friend.email}</p>
          )}
        </div>

        <ChevronRight
          className={`w-4 h-4 text-violet-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {/* Expanded profile */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-violet-800/50 space-y-2">
          {friend.email && (
            <div className="flex items-center gap-1.5 text-xs text-violet-300">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{friend.email}</span>
            </div>
          )}

          {friend.x_handle && (
            <a
              href={`https://twitter.com/${friend.x_handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-100 transition-colors"
            >
              <span>X: @{friend.x_handle}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}

          {friend.rsvp_name && (
            <div className="flex items-center gap-1.5 text-xs text-violet-300">
              <span>RSVP Name: {friend.rsvp_name}</span>
            </div>
          )}

          {!friend.email && !hasSocials && (
            <p className="text-xs text-violet-400">No profile info yet</p>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-red-400 transition-colors cursor-pointer mt-1"
          >
            <Trash2 className="w-3 h-3" />
            Remove friend
          </button>
        </div>
      )}
    </div>
  );
}

export function FriendsPanel({
  isOpen,
  onClose,
  friends,
  onRemoveFriend,
}: FriendsPanelProps) {
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 z-[70] h-full w-full max-w-sm bg-violet-950 border-l border-violet-800 shadow-2xl transition-transform duration-300 ease-in-out pt-[var(--safe-area-top)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-violet-900">
          <h2 className="text-lg font-bold text-white">
            Friends{' '}
            <span className="text-sm font-normal text-violet-300">
              ({friends.length})
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-violet-300 hover:text-white active:text-white transition-colors cursor-pointer"
            aria-label="Close friends panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-57px)] px-4 pb-4">
          {friends.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-12 h-12 text-violet-500 mb-4" />
              <p className="text-violet-300 font-medium mb-2">No friends yet</p>
              <p className="text-violet-400 text-sm max-w-xs">
                Share a friend link from your profile to connect!
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {friends.map((friend) => (
                <FriendCard
                  key={friend.user_id}
                  friend={friend}
                  onRemove={() => onRemoveFriend(friend.user_id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

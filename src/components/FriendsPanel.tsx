'use client';

import { X, Trash2, ExternalLink, Users } from 'lucide-react';
import type { Friend } from '@/lib/types';

interface FriendsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  friends: Friend[];
  onRemoveFriend: (userId: string) => void;
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
        className={`fixed top-0 right-0 z-[70] h-full w-full max-w-sm bg-slate-900 border-l border-slate-700 shadow-2xl transition-transform duration-300 ease-in-out pt-[var(--safe-area-top)] ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">
            Friends{' '}
            <span className="text-sm font-normal text-slate-400">
              ({friends.length})
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white active:text-white transition-colors cursor-pointer"
            aria-label="Close friends panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-[calc(100%-57px)] px-4 pb-4">
          {friends.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="w-12 h-12 text-slate-600 mb-4" />
              <p className="text-slate-400 font-medium mb-2">
                No friends yet
              </p>
              <p className="text-slate-500 text-sm max-w-xs">
                Share a friend link from your profile to connect!
              </p>
            </div>
          ) : (
            <div className="space-y-2 mt-3">
              {friends.map((friend) => (
                <div
                  key={friend.user_id}
                  className="bg-slate-800 rounded-lg p-3 border border-slate-700"
                >
                  {/* Top row: name + remove */}
                  <div className="flex items-start gap-2">
                    <h4 className="flex-1 text-sm font-semibold text-white leading-tight min-w-0 truncate">
                      {friend.display_name || 'Anonymous'}
                    </h4>
                    <button
                      onClick={() => onRemoveFriend(friend.user_id)}
                      className="shrink-0 p-1 text-slate-500 hover:text-red-400 active:text-red-400 transition-colors cursor-pointer"
                      aria-label="Remove friend"
                      title="Remove friend"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Social handles */}
                  <div className="flex flex-col gap-1 mt-1.5">
                    {friend.x_handle && (
                      <a
                        href={`https://twitter.com/${friend.x_handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors text-xs"
                      >
                        <span>@{friend.x_handle}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {friend.farcaster_username && (
                      <a
                        href={`https://warpcast.com/${friend.farcaster_username}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors text-xs"
                      >
                        <span>@{friend.farcaster_username}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

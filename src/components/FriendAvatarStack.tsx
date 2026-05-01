'use client';

import type { FriendInfo } from '@/lib/types';

interface FriendAvatarStackProps {
  friends: FriendInfo[];
  maxShow?: number;
  size?: 'sm' | 'md';
}

export function FriendAvatarStack({ friends, maxShow = 3, size = 'sm' }: FriendAvatarStackProps) {
  const shown = friends.slice(0, maxShow);
  const overflow = friends.length - maxShow;
  const dim = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';
  const textSize = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  const overflowTextSize = size === 'sm' ? 'text-[8px]' : 'text-[9px]';
  const ml = size === 'sm' ? '-ml-1.5' : '-ml-2';

  return (
    <div className="flex items-center">
      {shown.map((friend, i) => (
        <div
          key={friend.userId}
          className={`${dim} rounded-full border-2 border-[var(--theme-bg-card)] flex items-center justify-center shrink-0 overflow-hidden ${i > 0 ? ml : ''}`}
          style={{ zIndex: maxShow - i }}
          title={friend.displayName}
        >
          {friend.avatarUrl ? (
            <img src={friend.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span
              className={`${textSize} font-bold text-white flex items-center justify-center w-full h-full`}
              style={{ backgroundColor: 'var(--friend-blue)' }}
            >
              {friend.displayName[0]?.toUpperCase() ?? '?'}
            </span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <div
          className={`${dim} rounded-full border-2 border-[var(--theme-bg-card)] flex items-center justify-center shrink-0 ${ml}`}
          style={{ backgroundColor: 'var(--friend-blue)', zIndex: 0 }}
        >
          <span className={`${overflowTextSize} font-bold text-white`}>+{overflow}</span>
        </div>
      )}
    </div>
  );
}

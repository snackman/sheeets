'use client';

import type { FriendInfo } from '@/lib/types';
import UserAvatar from './UserAvatar';

interface FriendAvatarStackProps {
  friends: FriendInfo[];
  maxShow?: number;
  size?: 'sm' | 'md';
}

export function FriendAvatarStack({ friends, maxShow = 3, size = 'sm' }: FriendAvatarStackProps) {
  const shown = friends.slice(0, maxShow);
  const overflow = friends.length - maxShow;
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-7 h-7';
  const avatarSize = size === 'sm' ? 'xs' as const : 'sm' as const;
  const overflowTextSize = size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  const ml = size === 'sm' ? '-ml-2' : '-ml-2.5';

  return (
    <div className="flex items-center">
      {shown.map((friend, i) => (
        <div
          key={friend.userId}
          className={`${dim} rounded-full border-2 border-[var(--theme-bg-card)] shrink-0 overflow-hidden ${i > 0 ? ml : ''}`}
          style={{ zIndex: maxShow - i }}
          title={friend.displayName}
        >
          <UserAvatar
            avatarUrl={friend.avatarUrl}
            xHandle={friend.xHandle}
            displayName={friend.displayName}
            size={avatarSize}
            className="!w-full !h-full"
          />
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

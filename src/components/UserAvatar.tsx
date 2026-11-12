'use client';

import { useState } from 'react';
import { getDisplayInitial } from '@/lib/user-display';

const AVATAR_COLORS = Array.from({ length: 10 }, (_, i) => `var(--theme-avatar-${i + 1})`);

function hashToColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface UserAvatarProps {
  avatarUrl?: string | null;
  xHandle?: string | null;
  displayName?: string | null;
  email?: string | null;
  userId?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-2xs',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

export default function UserAvatar({
  avatarUrl,
  xHandle,
  displayName,
  email,
  userId,
  size = 'sm',
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const [unavatarError, setUnavatarError] = useState(false);

  const sizeClass = sizeClasses[size];
  const initial = getDisplayInitial({ display_name: displayName, rsvp_name: email || undefined });

  // Priority 1: Uploaded avatar
  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || 'User avatar'}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
        loading="lazy"
        decoding="async"
        onError={() => setImgError(true)}
      />
    );
  }

  // Priority 2: X/Twitter avatar via unavatar.io
  if (xHandle && !unavatarError) {
    return (
      <img
        src={`https://unavatar.io/x/${xHandle}`}
        alt={displayName || xHandle}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
        loading="lazy"
        decoding="async"
        onError={() => setUnavatarError(true)}
      />
    );
  }

  // Priority 3: Initials circle with deterministic color
  const bgColor = userId ? hashToColor(userId) : undefined;
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-bold text-[var(--theme-avatar-text)] shrink-0 ${className}`}
      style={{ backgroundColor: bgColor || 'var(--theme-bg-tertiary)' }}
    >
      {initial}
    </div>
  );
}

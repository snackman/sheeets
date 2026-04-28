'use client';

import { useState } from 'react';
import { getDisplayInitial } from '@/lib/user-display';

interface UserAvatarProps {
  avatarUrl?: string | null;
  xHandle?: string | null;
  displayName?: string | null;
  email?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
};

export default function UserAvatar({
  avatarUrl,
  xHandle,
  displayName,
  email,
  size = 'sm',
  className = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);
  const [unavatarError, setUnavatarError] = useState(false);

  const sizeClass = sizeClasses[size];
  const initial = getDisplayInitial({ display_name: displayName, email: email || undefined });

  // Priority 1: Uploaded avatar
  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || 'User avatar'}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${className}`}
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
        onError={() => setUnavatarError(true)}
      />
    );
  }

  // Priority 3: Initials circle
  return (
    <div
      className={`${sizeClass} rounded-full bg-[var(--theme-bg-tertiary)] flex items-center justify-center font-bold text-[var(--theme-text-secondary)] shrink-0 ${className}`}
    >
      {initial}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ViewMode } from '@/lib/types';
import { STORAGE_KEYS } from '@/lib/storage-keys';

/**
 * Manages view mode (map/list/table) with localStorage persistence.
 * Returns the current mode, setter, restored flag, and scroll-tracking refs.
 */
function getInitialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'map';
  const saved = localStorage.getItem(STORAGE_KEYS.VIEW_MODE);
  if (saved === 'map' || saved === 'list' || saved === 'table') return saved;
  return window.innerWidth >= 768 ? 'table' : 'list';
}

export function useViewMode() {
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode);
  const [viewRestored] = useState(true);
  const [contentScrolled, setContentScrolled] = useState(false);

  // Persist view mode to localStorage (skip the initial restore)
  useEffect(() => {
    if (viewRestored) {
      localStorage.setItem(STORAGE_KEYS.VIEW_MODE, viewMode);
    }
  }, [viewMode, viewRestored]);

  // List view scroll tracking (mirrors TableView's onScrolledChange)
  const listMainRef = useRef<HTMLDivElement>(null);
  const listLastScrollTopRef = useRef(0);
  const listScrolledRef = useRef(false);

  const handleListScroll = useCallback(() => {
    const container = listMainRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const atTop = scrollTop <= 5;
    const scrollingDown = scrollTop > listLastScrollTopRef.current + 2;
    const scrollingUp = scrollTop < listLastScrollTopRef.current - 2;
    listLastScrollTopRef.current = scrollTop;

    const overflowAmount = container.scrollHeight - container.clientHeight;
    const nearBottom = scrollTop + container.clientHeight >= container.scrollHeight - 50;
    const shouldHide = !atTop && !nearBottom && scrollingDown && overflowAmount > 80;
    const shouldShow = atTop || scrollingUp;

    if (shouldHide && !listScrolledRef.current) {
      listScrolledRef.current = true;
      setContentScrolled(true);
    } else if (shouldShow && listScrolledRef.current) {
      listScrolledRef.current = false;
      setContentScrolled(false);
    }
  }, []);

  return {
    viewMode,
    setViewMode,
    contentScrolled,
    setContentScrolled,
    listMainRef,
    handleListScroll,
  };
}

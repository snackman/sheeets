'use client';

import { useState, useRef, useCallback } from 'react';
import type { ViewMode } from '@/lib/types';
import { STORAGE_KEYS } from '@/lib/storage-keys';
import { useLocalStorageState } from './useLocalStorageState';

// Width-based default for visitors with no saved view, decided once per page
// load (on the first client read) so it doesn't flip when the window resizes.
let defaultViewMode: ViewMode | null = null;

function parseViewMode(saved: string | null): ViewMode {
  if (saved === 'map' || saved === 'list' || saved === 'table' || saved === 'gallery') {
    return saved;
  }
  if (!defaultViewMode) defaultViewMode = window.innerWidth >= 768 ? 'table' : 'list';
  return defaultViewMode;
}

/**
 * Manages view mode (map/list/table) with localStorage persistence.
 * Returns the current mode, setter, and scroll-tracking refs.
 */
export function useViewMode() {
  // 'list' is the SSR/hydration value (most common on mobile); the saved or
  // width-based mode is applied right after hydration (avoids a mismatch).
  const [storedViewMode, persistViewMode] = useLocalStorageState<ViewMode>(
    STORAGE_KEYS.VIEW_MODE,
    parseViewMode,
    'list'
  );
  // View applied from a shared URL: lasts for this session only and is never
  // written to localStorage, so it doesn't overwrite the recipient's preference.
  const [sessionView, setSessionView] = useState<ViewMode | null>(null);
  // True once the view came from the URL or an explicit user pick.
  const [viewExplicit, setViewExplicit] = useState(false);
  const viewMode = sessionView ?? storedViewMode;
  const [contentScrolled, setContentScrolled] = useState(false);

  // List view scroll tracking (mirrors TableView's onScrolledChange)
  const listMainRef = useRef<HTMLDivElement>(null);
  const listLastScrollTopRef = useRef(0);
  const listScrolledRef = useRef(false);

  // Persist to localStorage on change
  const setViewMode = useCallback((mode: ViewMode) => {
    persistViewMode(mode);
    setSessionView(null);
    setViewExplicit(true);
    setContentScrolled(false);
    listScrolledRef.current = false;
    listLastScrollTopRef.current = 0;
  }, [persistViewMode]);

  const applyUrlView = useCallback((mode: ViewMode) => {
    setSessionView(mode);
    setViewExplicit(true);
  }, []);

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
    applyUrlView,
    viewExplicit,
    contentScrolled,
    setContentScrolled,
    listMainRef,
    handleListScroll,
  };
}

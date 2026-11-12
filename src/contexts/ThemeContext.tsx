'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { ThemeId, DEFAULT_THEME, THEME_OPTIONS, THEME_STORAGE_KEY as STORAGE_KEY, LEGACY_THEME_STORAGE_KEY, defaultThemeFor, prefersDarkScheme } from '@/lib/themes';
const validIds = THEME_OPTIONS.map(t => t.id) as string[];

interface ThemeContextValue {
  theme: ThemeId;
  /** User's explicit choice: persisted, and wins over everything else. */
  setTheme: (theme: ThemeId) => void;
  /** Per-conference theme from admin config (or null for none): applied but never persisted. */
  setConfigTheme: (theme: ThemeId | null) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  setConfigTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: ReactNode;
  adminConfig?: Record<string, unknown> | null;
  conference?: string;
}

function readStoredTheme(): ThemeId | null {
  try {
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && validIds.includes(stored)) return stored as ThemeId;
  } catch {}
  return null;
}

export function ThemeProvider({ children, adminConfig, conference }: ThemeProviderProps) {
  // Theme the user picked manually (persisted); wins over the admin config.
  const [userTheme, setUserTheme] = useState<ThemeId | null>(readStoredTheme);

  // OS colour-scheme preference: picks the dark default when nothing else is configured.
  const [prefersDark, setPrefersDark] = useState<boolean>(prefersDarkScheme);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Otherwise use the per-conference theme from admin config (derived during render).
  const [pushedConfigTheme, setConfigTheme] = useState<ThemeId | null>(null);
  const propConfigTheme = adminConfig && conference
    ? (adminConfig[`theme:${conference}`] as string | undefined)
    : undefined;
  const configTheme: string | undefined = pushedConfigTheme ?? propConfigTheme;
  const theme: ThemeId = userTheme
    ?? (configTheme && validIds.includes(configTheme) ? (configTheme as ThemeId) : defaultThemeFor(prefersDark));

  // Apply data-theme attribute to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    return () => {
      document.documentElement.removeAttribute('data-theme');
    };
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeId) => {
    setUserTheme(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, setConfigTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

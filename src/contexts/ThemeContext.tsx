'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { ThemeId, DEFAULT_THEME } from '@/lib/themes';

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface ThemeProviderProps {
  children: ReactNode;
  adminConfig?: Record<string, unknown> | null;
  conference?: string;
}

export function ThemeProvider({ children, adminConfig, conference }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeId>(DEFAULT_THEME);

  // Read theme from admin config when conference changes
  useEffect(() => {
    if (!adminConfig || !conference) {
      setThemeState(DEFAULT_THEME);
      return;
    }

    const configKey = `theme:${conference}`;
    const configTheme = adminConfig[configKey] as string | undefined;

    if (configTheme === 'dark' || configTheme === 'paper' || configTheme === 'light' || configTheme === 'sxsw' || configTheme === 'sxsw2' || configTheme === 'gdc' || configTheme === 'ethcc') {
      setThemeState(configTheme);
    } else {
      setThemeState(DEFAULT_THEME);
    }
  }, [adminConfig, conference]);

  // Apply data-theme attribute to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    return () => {
      document.documentElement.removeAttribute('data-theme');
    };
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeId) => {
    setThemeState(newTheme);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

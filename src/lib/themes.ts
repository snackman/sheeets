export type ThemeId = 'dark' | 'paper' | 'light' | 'light-blue' | 'sxsw' | 'sxsw2' | 'gdc' | 'ethcc';

/** Theme used when nothing is stored, no conference theme is configured, and the OS asks for light (or nothing). */
export const DEFAULT_THEME: ThemeId = 'light-blue';

/** Theme used instead of DEFAULT_THEME when the OS prefers a dark colour scheme. */
export const DEFAULT_DARK_THEME: ThemeId = 'dark';

export const THEME_STORAGE_KEY = 'user-theme-override';

export const THEME_OPTIONS: { id: ThemeId; label: string; isLight: boolean }[] = [
  { id: 'dark', label: 'Dark', isLight: false },
  { id: 'paper', label: 'Paper', isLight: true },
  { id: 'light', label: 'Light', isLight: true },
  { id: 'light-blue', label: 'Light Blue', isLight: true },
  { id: 'sxsw', label: 'SXSW', isLight: false },
  { id: 'sxsw2', label: 'SXSW2', isLight: false },
  { id: 'gdc', label: 'GDC', isLight: false },
  { id: 'ethcc', label: 'EthCC', isLight: false },
];

/** True when the theme has a light page background (drives the map style and similar). */
export function isLightTheme(id: ThemeId): boolean {
  return THEME_OPTIONS.find((t) => t.id === id)?.isLight ?? false;
}

/** Fallback theme when the user has not chosen one: dark for dark-scheme OS, else the light default. */
export function defaultThemeFor(prefersDark: boolean): ThemeId {
  return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_THEME;
}

/** True when the OS asks for a dark colour scheme (false on the server / without matchMedia). */
export function prefersDarkScheme(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * Inline script run in <head> before first paint so data-theme is right with no flash.
 * Mirrors ThemeContext: stored user override wins, otherwise prefers-color-scheme picks
 * DEFAULT_DARK_THEME; otherwise the server-rendered DEFAULT_THEME attribute stays.
 * Keep it ES5 and dependency-free. (CSP allows inline scripts; there is no hash to update.)
 */
export const THEME_INIT_SCRIPT =
  `(function(){var d=document.documentElement,t=null;` +
  `try{t=localStorage.getItem('${THEME_STORAGE_KEY}')}catch(e){}` +
  `if(!t){try{if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='${DEFAULT_DARK_THEME}'}catch(e){}}` +
  `if(t)d.setAttribute('data-theme',t)})()`;

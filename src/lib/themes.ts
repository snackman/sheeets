export type ThemeId = 'dark' | 'paper' | 'light' | 'sxsw';

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'paper', label: 'Paper' },
  { id: 'light', label: 'Light' },
  { id: 'sxsw', label: 'SXSW' },
];

export type ThemeId = 'dark' | 'paper' | 'light' | 'sxsw' | 'sxsw2' | 'gdc' | 'ethcc';

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'paper', label: 'Paper' },
  { id: 'light', label: 'Light' },
  { id: 'sxsw', label: 'SXSW' },
  { id: 'sxsw2', label: 'SXSW2' },
  { id: 'gdc', label: 'GDC' },
  { id: 'ethcc', label: 'EthCC' },
];

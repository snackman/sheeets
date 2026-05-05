export type ThemeId = 'dark' | 'paper' | 'light' | 'light-blue' | 'sxsw' | 'sxsw2' | 'gdc' | 'ethcc';

export const DEFAULT_THEME: ThemeId = 'dark';

export const THEME_OPTIONS: { id: ThemeId; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'paper', label: 'Paper' },
  { id: 'light', label: 'Light' },
  { id: 'light-blue', label: 'Light Blue' },
  { id: 'sxsw', label: 'SXSW' },
  { id: 'sxsw2', label: 'SXSW2' },
  { id: 'gdc', label: 'GDC' },
  { id: 'ethcc', label: 'EthCC' },
];

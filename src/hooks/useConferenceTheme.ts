import { useEffect } from 'react';

const CONFERENCE_THEMES: Record<string, string> = {
  'SXSW 2026': 'sxsw',
};

export function useConferenceTheme(conference: string) {
  useEffect(() => {
    const theme = CONFERENCE_THEMES[conference];
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    return () => document.documentElement.removeAttribute('data-theme');
  }, [conference]);
}

export function isLumaUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === 'lu.ma' || h === 'luma.com' || h === 'www.luma.com';
  } catch {
    return false;
  }
}

export function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname;
    if (h !== 'lu.ma' && h !== 'luma.com' && h !== 'www.luma.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}

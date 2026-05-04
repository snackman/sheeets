export interface SocialLink {
  platform: 'x' | 'telegram' | 'linkedin' | 'friend';
  label: string;
  url: string;
}

export function getSocialLinks(profile: {
  x_handle?: string | null;
  telegram_handle?: string | null;
  linkedin_url?: string | null;
}): SocialLink[] {
  const links: SocialLink[] = [];

  if (profile.x_handle) {
    const handle = profile.x_handle.replace(/^@/, '');
    links.push({
      platform: 'x',
      label: `@${handle}`,
      url: `https://x.com/${handle}`,
    });
  }

  if (profile.telegram_handle) {
    const raw = profile.telegram_handle.replace(/^@/, '').replace(/^https?:\/\/t\.me\//, '');
    const isGroup = raw.startsWith('+');
    links.push({
      platform: 'telegram',
      label: isGroup ? raw : `@${raw}`,
      url: `https://t.me/${raw}`,
    });
  }

  if (profile.linkedin_url) {
    const url = profile.linkedin_url.startsWith('http')
      ? profile.linkedin_url
      : `https://${profile.linkedin_url}`;
    links.push({
      platform: 'linkedin',
      label: 'LinkedIn',
      url,
    });
  }

  return links;
}

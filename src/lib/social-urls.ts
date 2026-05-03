export interface SocialLink {
  platform: 'x' | 'telegram' | 'linkedin';
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
    const handle = profile.telegram_handle.replace(/^@/, '');
    links.push({
      platform: 'telegram',
      label: `@${handle}`,
      url: `https://t.me/${handle}`,
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

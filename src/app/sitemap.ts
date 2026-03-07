import type { MetadataRoute } from 'next';
import { EVENT_TABS } from '@/lib/constants';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://plan.wtf';

  const conferencePages = EVENT_TABS.map((tab) => ({
    url: `${baseUrl}/${tab.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.9,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 1.0,
    },
    ...conferencePages,
  ];
}

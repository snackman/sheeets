import type { MetadataRoute } from 'next';
import { FALLBACK_TABS } from '@/lib/constants';
import { getConferenceTabs } from '@/lib/get-conferences';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://plan.wtf';

  let tabs = FALLBACK_TABS;
  try {
    tabs = await getConferenceTabs();
  } catch {
    // Use fallback
  }

  const conferencePages = tabs.map((tab) => ({
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

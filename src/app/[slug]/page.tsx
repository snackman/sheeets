import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { EventApp } from '@/components/EventApp';
import { FALLBACK_TABS, getTabBySlug, withCurrentTab } from '@/lib/constants';
import { getAllConferenceTabs, getConferenceTabs } from '@/lib/get-conferences';
import { fetchEventsCached } from '@/lib/fetch-events-cached';
import { buildCollectionPageJsonLd, buildBreadcrumbJsonLd, serializeJsonLd } from '@/lib/json-ld';

// Revalidate every 60s so new conferences/events appear without a redeploy
export const revalidate = 60;

export function generateStaticParams() {
  // Use fallback tabs for build-time static generation (guaranteed)
  return FALLBACK_TABS.map((tab) => ({ slug: tab.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const allTabs = await getAllConferenceTabs();
  const tab = getTabBySlug(slug, allTabs);
  if (!tab) return {};

  const allEvents = await fetchEventsCached();
  const count = allEvents.filter((e) => e.conference === tab.name).length;

  return {
    title: `${tab.name} Side Events`,
    description: `Browse ${count}+ side events for ${tab.name}. Filter by date, time, tags, and more.`,
    openGraph: {
      title: `${tab.name} Side Events | plan.wtf`,
      description: `Browse ${count}+ side events for ${tab.name}. Filter by date, time, tags, and more.`,
      url: `https://plan.wtf/${tab.slug}`,
      images: [{ url: '/og-image.png', width: 1200, height: 630, alt: `${tab.name} side events on plan.wtf` }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${tab.name} Side Events | plan.wtf`,
      description: `Browse ${count}+ side events for ${tab.name}. Filter by date, time, tags, and more.`,
      images: ['/og-image.png'],
    },
  };
}

export default async function ConferencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // `allTabs` (every conference, including hidden/past) is needed to
  // resolve a slug for ROUTING -- a hidden/past conference's own page must
  // still be directly reachable. But sending the full list down to the
  // client as `initialConferenceTabs` shipped every hidden conference's
  // name/dates/center in this page's RSC payload for EVERY conference
  // page, public ones included (review finding, MEDIUM). `publicTabs`
  // (active only) is what actually goes to the client, with the current
  // tab merged in if it isn't already there -- so a hidden/past
  // conference's OWN page still gets its own correct dates/center (fixes
  // the map center / mini-calendar reverting to DEFAULT_TAB on those
  // pages, too), without leaking every OTHER hidden conference.
  const [allTabs, publicTabs] = await Promise.all([getAllConferenceTabs(), getConferenceTabs()]);
  const tab = getTabBySlug(slug, allTabs);
  // An unknown conference slug is a missing resource, not a redirect to
  // home -- a 307-to-home on a typo'd/stale URL told crawlers and
  // visitors the page "moved" to "/", which isn't true and can get a
  // dead slug indexed as a duplicate of the home page.
  if (!tab) notFound();

  const initialConferenceTabs = withCurrentTab(publicTabs, tab);

  const allEvents = await fetchEventsCached();
  const conferenceEvents = allEvents.filter((e) => e.conference === tab.name);

  const collectionJsonLd = buildCollectionPageJsonLd(tab.name, tab.slug, conferenceEvents);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd(tab.name, tab.slug);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(collectionJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <Suspense>
        <EventApp
          initialConference={tab.name}
          initialEvents={conferenceEvents}
          initialConferenceTabs={initialConferenceTabs}
        />
      </Suspense>
    </>
  );
}

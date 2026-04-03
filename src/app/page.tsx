import { Suspense } from 'react';
import { EventApp } from '@/components/EventApp';
import { DEFAULT_TAB } from '@/lib/constants';
import { fetchEventsCached } from '@/lib/fetch-events-cached';
import { buildCollectionPageJsonLd } from '@/lib/json-ld';

export const metadata = {
  title: `${DEFAULT_TAB.name} Side Events`,
  description: `Browse side events for ${DEFAULT_TAB.name}. Filter by date, time, tags, and more.`,
};

export default async function Home() {
  const allEvents = await fetchEventsCached();
  // The default conference is the first conference tab (dynamic or fallback)
  // Use DEFAULT_TAB.name for the JSON-LD since metadata is static
  const conferenceEvents = allEvents.filter((e) => e.conference === DEFAULT_TAB.name);
  const collectionJsonLd = buildCollectionPageJsonLd(
    DEFAULT_TAB.name,
    DEFAULT_TAB.slug,
    conferenceEvents,
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
      />
      <Suspense>
        <EventApp />
      </Suspense>
    </>
  );
}

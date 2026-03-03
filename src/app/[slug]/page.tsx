import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { EventApp } from '@/components/EventApp';
import { getTabBySlug, EVENT_TABS } from '@/lib/constants';

export function generateStaticParams() {
  return EVENT_TABS.map((tab) => ({ slug: tab.slug }));
}

export default async function ConferencePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tab = getTabBySlug(slug);
  if (!tab) redirect('/');

  return (
    <Suspense>
      <EventApp initialConference={tab.name} />
    </Suspense>
  );
}

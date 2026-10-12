// Public host-submission page (Phase 3, plans/event-ingestion.md §3.5).
// Server component: resolves the active conference list the same way
// `/api/submit-event` does, then hands off to the client form.
import { FALLBACK_TABS } from '@/lib/conferences';
import { getConferenceTabs } from '@/lib/get-conferences';
import { SubmitSourceForm } from '@/components/SubmitSourceForm';

export const metadata = {
  title: 'Submit an event link — plan.wtf',
  description: 'Submit your Luma, Partiful, Eventbrite, Meetup, or Posh event link for a conference.',
};

export default async function SubmitSourcePage() {
  let tabs = FALLBACK_TABS;
  try {
    tabs = await getConferenceTabs();
  } catch {
    // Use fallback.
  }

  return (
    <main className="min-h-screen bg-[var(--theme-bg-primary)] text-[var(--theme-text-primary)] px-4 py-12">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Submit an event link</h1>
        <p className="text-sm text-[var(--theme-text-secondary)] mb-8">
          Hosting a side event? Drop your Luma, Partiful, Eventbrite, Meetup, or Posh link below and we&apos;ll
          review it for the right conference. Submissions are reviewed before anything goes live.
        </p>
        <SubmitSourceForm conferenceTabs={tabs.map((t) => ({ name: t.name, slug: t.slug }))} />
      </div>
    </main>
  );
}

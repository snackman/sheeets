import Image from 'next/image';
import { getConferenceTabs } from '@/lib/get-conferences';
import { fetchEventsCached } from '@/lib/fetch-events-cached';
import type { TabConfig } from '@/lib/conferences';

export const metadata = {
  title: 'plan.wtf — Conference Side Events',
  description:
    'Browse side events for crypto and tech conferences. Filter by date, time, tags, and more.',
};

/**
 * Format a date range from an array of ISO date strings.
 * e.g. ["2026-04-11", ..., "2026-04-17"] -> "Apr 11 – 17, 2026"
 * If months differ: "Apr 28 – May 1, 2026"
 */
function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return '';

  const first = new Date(dates[0] + 'T12:00:00');
  const last = new Date(dates[dates.length - 1] + 'T12:00:00');

  const startMonth = first.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = last.toLocaleDateString('en-US', { month: 'short' });
  const startDay = first.getDate();
  const endDay = last.getDate();
  const year = last.getFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}\u2013${endDay}, ${year}`;
  }
  return `${startMonth} ${startDay} \u2013 ${endMonth} ${endDay}, ${year}`;
}

/**
 * Derive a city name from the conference center coordinates.
 */
function getCity(tab: TabConfig): string {
  const { lat, lng } = tab.center;

  // Known conference cities by approximate coordinates
  if (Math.abs(lat - 48.8566) < 0.5 && Math.abs(lng - 2.3522) < 0.5) return 'Paris';
  if (Math.abs(lat - 36.1699) < 0.5 && Math.abs(lng + 115.1398) < 0.5) return 'Las Vegas';
  if (Math.abs(lat - 25.7617) < 0.5 && Math.abs(lng + 80.1918) < 0.5) return 'Miami';
  if (Math.abs(lat - 39.7392) < 0.5 && Math.abs(lng + 104.9903) < 0.5) return 'Denver';
  if (Math.abs(lat - 30.2672) < 0.5 && Math.abs(lng + 97.7431) < 0.5) return 'Austin';
  if (Math.abs(lat - 40.7128) < 0.5 && Math.abs(lng + 74.006) < 0.5) return 'New York';
  if (Math.abs(lat - 37.7749) < 0.5 && Math.abs(lng + 122.4194) < 0.5) return 'San Francisco';
  if (Math.abs(lat - 1.3521) < 0.5 && Math.abs(lng - 103.8198) < 0.5) return 'Singapore';
  if (Math.abs(lat - 51.5074) < 0.5 && Math.abs(lng + 0.1278) < 0.5) return 'London';
  if (Math.abs(lat - 52.52) < 0.5 && Math.abs(lng - 13.405) < 0.5) return 'Berlin';
  if (Math.abs(lat - 41.3874) < 0.5 && Math.abs(lng - 2.1686) < 0.5) return 'Barcelona';
  if (Math.abs(lat - 35.6762) < 0.5 && Math.abs(lng - 139.6503) < 0.5) return 'Tokyo';
  if (Math.abs(lat - 13.7563) < 0.5 && Math.abs(lng - 100.5018) < 0.5) return 'Bangkok';
  if (Math.abs(lat - 22.3193) < 0.5 && Math.abs(lng - 114.1694) < 0.5) return 'Hong Kong';
  if (Math.abs(lat - 43.6532) < 0.5 && Math.abs(lng + 79.3832) < 0.5) return 'Toronto';
  if (Math.abs(lat - 47.6062) < 0.5 && Math.abs(lng + 122.3321) < 0.5) return 'Seattle';
  if (Math.abs(lat - 34.0522) < 0.5 && Math.abs(lng + 118.2437) < 0.5) return 'Los Angeles';

  // Fallback: extract from timezone
  const city = tab.timezone.split('/').pop()?.replace(/_/g, ' ');
  return city || '';
}

export default async function Home() {
  const tabs = await getConferenceTabs();
  const allEvents = await fetchEventsCached();

  // Count events per conference
  const eventCounts = new Map<string, number>();
  for (const event of allEvents) {
    eventCounts.set(event.conference, (eventCounts.get(event.conference) || 0) + 1);
  }


  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center px-4 py-16 sm:py-24"
      style={{ backgroundColor: 'var(--theme-bg-primary)' }}
    >
      {/* Logo */}
      <div className="mb-4">
        <Image
          src="/logo.png"
          alt="plan.wtf"
          width={200}
          height={55}
          style={{ filter: 'var(--theme-logo-filter)' }}
          priority
        />
      </div>

      {/* Tagline */}
      <p
        className="text-lg sm:text-xl mb-12 tracking-wide"
        style={{ color: 'var(--theme-text-secondary)' }}
      >
        Conference Side Events
      </p>

      {/* Conference grid */}
      <div className="w-full max-w-3xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tabs.map((tab) => {
          const city = getCity(tab);
          const dateRange = formatDateRange(tab.dates);
          const count = eventCounts.get(tab.name) || 0;

          return (
            <a
              key={tab.slug}
              href={`/${tab.slug}`}
              className="group block rounded-xl border p-5 transition-all duration-200 hover:scale-[1.02]"
              style={{
                backgroundColor: 'var(--theme-bg-card)',
                borderColor: 'var(--theme-border-primary)',
              }}
            >
              {/* Conference name */}
              <h2
                className="text-lg font-semibold mb-2 transition-colors duration-200"
                style={{ color: 'var(--theme-text-primary)' }}
              >
                <span className="group-hover:text-[var(--theme-accent)]">{tab.name}</span>
              </h2>

              {/* Date range */}
              {dateRange && (
                <p
                  className="text-sm mb-1"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {dateRange}
                </p>
              )}

              {/* City */}
              {city && (
                <p
                  className="text-sm"
                  style={{ color: 'var(--theme-text-muted)' }}
                >
                  {city}
                </p>
              )}

              {/* Event count */}
              {count > 0 && (
                <p
                  className="text-sm font-medium mt-3"
                  style={{ color: 'var(--theme-accent)' }}
                >
                  {count} events
                </p>
              )}
            </a>
          );
        })}
      </div>
    </main>
  );
}

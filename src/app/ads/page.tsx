import type { Metadata } from 'next';
import Link from 'next/link';
import { AdvertiseContent } from './AdvertiseContent';

export const metadata: Metadata = {
  title: 'Advertise on plan.wtf - Reach Crypto Conference Attendees',
  description:
    'Promote your brand, event, or product to thousands of crypto conference attendees. Sponsored placements, featured listings, and more.',
  openGraph: {
    title: 'Advertise on plan.wtf',
    description:
      'Reach crypto conference attendees with sponsored placements, featured listings, and native ads.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Advertise on plan.wtf',
    description:
      'Reach crypto conference attendees with sponsored placements, featured listings, and native ads.',
  },
};

export default function AdvertisePage() {
  return (
    <div className="min-h-screen bg-stone-950">
      {/* Sticky nav bar */}
      <header className="sticky top-0 z-50 bg-stone-950/95 backdrop-blur-sm border-b border-stone-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-bold text-white hover:text-amber-400 transition-colors"
          >
            plan.wtf
          </Link>
          <span className="text-xs text-stone-500 font-mono">
            Advertise
          </span>
        </div>
      </header>

      <AdvertiseContent />
    </div>
  );
}

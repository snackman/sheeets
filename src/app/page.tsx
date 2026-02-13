import { Suspense } from 'react';
import { EventApp } from '@/components/EventApp';

export default function Home() {
  return (
    <Suspense>
      <EventApp />
    </Suspense>
  );
}

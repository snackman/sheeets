'use client';

import { useState, useEffect, useRef } from 'react';

interface OGImageProps {
  url: string;
  eventId?: string;
}

const imageCache = new Map<string, string | null>();

export function OGImage({ url, eventId }: OGImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(
    imageCache.get(url) ?? null
  );
  const [loaded, setLoaded] = useState(imageCache.has(url));
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (imageCache.has(url)) {
      setImageUrl(imageCache.get(url) ?? null);
      setLoaded(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();

        const params = new URLSearchParams({ url });
        if (eventId) params.set('eventId', eventId);

        fetch(`/api/og?${params.toString()}`)
          .then((res) => res.json())
          .then((data) => {
            imageCache.set(url, data.imageUrl);
            setImageUrl(data.imageUrl);
            setLoaded(true);
          })
          .catch(() => {
            imageCache.set(url, null);
            setLoaded(true);
          });
      },
      { rootMargin: '200px' }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [url, eventId]);

  if (loaded && !imageUrl) return null;
  if (error) return null;

  return (
    <div ref={ref} className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-lg overflow-hidden bg-gray-200/30 dark:bg-slate-700/30 self-center">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-full object-contain bg-gray-100/50 dark:bg-slate-900/50"
          loading="lazy"
          onError={() => setError(true)}
        />
      )}
      {!loaded && (
        <div className="w-full h-full animate-pulse bg-gray-200/50 dark:bg-slate-700/50" />
      )}
    </div>
  );
}

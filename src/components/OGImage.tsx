'use client';

import { useState, useEffect, useRef } from 'react';

interface OGImageProps {
  url: string;
}

const imageCache = new Map<string, string | null>();

export function OGImage({ url }: OGImageProps) {
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

        fetch(`/api/og?url=${encodeURIComponent(url)}`)
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
  }, [url]);

  if (loaded && !imageUrl) return null;
  if (error) return null;

  return (
    <div ref={ref} className="mt-2 rounded-lg overflow-hidden bg-slate-700/30">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full h-32 object-cover"
          loading="lazy"
          onError={() => setError(true)}
        />
      )}
      {!loaded && (
        <div className="w-full h-32 animate-pulse bg-slate-700/50" />
      )}
    </div>
  );
}

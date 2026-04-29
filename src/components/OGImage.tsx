'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface OGImageProps {
  url: string;
  eventId?: string;
  rsvpUrl?: string;
}

const imageCache = new Map<string, string | null>();

export function OGImage({ url, eventId, rsvpUrl }: OGImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(
    imageCache.get(url) ?? null
  );
  const [loaded, setLoaded] = useState(imageCache.has(url));
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
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

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen]);

  useEffect(() => {
    if (!lightboxOpen) return;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [lightboxOpen]);

  if (loaded && !imageUrl) return null;
  if (error) return null;

  return (
    <>
      <div
        ref={ref}
        className="shrink-0 w-[88px] sm:w-[106px] rounded-lg overflow-hidden bg-stone-800/30 self-center cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          if (imageUrl) setLightboxOpen(true);
        }}
        role="button"
        tabIndex={0}
        aria-label="View image fullscreen"
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="w-full h-auto rounded-lg"
            loading="lazy"
            onError={() => setError(true)}
          />
        )}
        {!loaded && (
          <div className="w-full h-[88px] sm:h-[106px] animate-pulse bg-stone-800/50" />
        )}
      </div>

      {lightboxOpen && imageUrl && createPortal(
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer z-10"
            aria-label="Close lightbox"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <img
              src={imageUrl}
              alt=""
              className="max-w-[60vw] max-h-[60vh] object-contain rounded-lg"
            />
            {rsvpUrl && (
              <a
                href={rsvpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
              >
                RSVP / Event Page &rarr;
              </a>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

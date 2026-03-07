'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function AddressAutocomplete({
  value,
  onChange,
  placeholder = '1234 Market St, Denver',
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setIsLoaded(true);
      return;
    }

    const initAutocomplete = () => {
      if (!inputRef.current || !window.google?.maps?.places) return;

      const autocomplete = new window.google.maps.places.Autocomplete(
        inputRef.current,
        {
          types: ['geocode', 'establishment'],
          fields: ['formatted_address', 'name'],
        }
      );

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        const address = place.formatted_address || place.name || '';
        if (address) onChangeRef.current(address);
      });

      setIsLoaded(true);
    };

    // Already loaded
    if (window.google?.maps?.places) {
      initAutocomplete();
      return;
    }

    // Script tag exists but still loading
    const existing = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );
    if (existing) {
      const wait = () => {
        if (window.google?.maps?.places) initAutocomplete();
        else setTimeout(wait, 100);
      };
      wait();
      return;
    }

    // Load script
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=Function.prototype`;
    script.async = true;
    script.defer = true;
    script.onload = () => initAutocomplete();
    script.onerror = () => setIsLoaded(true);
    document.head.appendChild(script);
  }, []);

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 pointer-events-none z-10" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-blue-950 border border-blue-600 rounded-lg text-white text-sm pl-9 pr-3 py-2 focus:border-yellow-500 focus:outline-none placeholder:text-blue-500"
      />
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Navigation, Car, X } from 'lucide-react';

function buildNavUrls(address: string, lat?: number, lng?: number) {
  const encoded = encodeURIComponent(address);
  const dest = lat != null ? `${lat},${lng}` : encoded;

  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${dest}`,
    uber: `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encoded}${lat != null ? `&dropoff[latitude]=${lat}&dropoff[longitude]=${lng}` : ''}`,
    lyft: `https://ride.lyft.com/ridetype?destination[address]=${encoded}${lat != null ? `&destination[latitude]=${lat}&destination[longitude]=${lng}` : ''}`,
  };
}

interface NavigationSheetProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  lat?: number;
  lng?: number;
}

function NavigationSheet({ isOpen, onClose, address, lat, lng }: NavigationSheetProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const urls = buildNavUrls(address, lat, lng);

  const options = [
    { label: 'Google Maps', url: urls.google, icon: <Navigation className="w-5 h-5" />, color: 'text-blue-400' },
    { label: 'Uber', url: urls.uber, icon: <Car className="w-5 h-5" />, color: 'text-white' },
    { label: 'Lyft', url: urls.lyft, icon: <Car className="w-5 h-5" />, color: 'text-pink-400' },
  ];

  return createPortal(
    <>
      <div className="fixed inset-0 z-[80] bg-black/50" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-[90] bg-slate-800 border-t border-slate-700 rounded-t-2xl p-4 pb-8">
        <p className="text-slate-400 text-xs mb-3 truncate px-1">{address}</p>
        <div className="space-y-1">
          {options.map((opt) => (
            <a
              key={opt.label}
              href={opt.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-center gap-3 w-full px-4 py-3 text-white hover:bg-slate-700/50 transition-colors rounded-lg"
            >
              <span className={opt.color}>{opt.icon}</span>
              <span className="text-sm font-medium">{opt.label}</span>
            </a>
          ))}
        </div>
        <button
          onClick={onClose}
          className="w-full mt-2 py-3 text-slate-400 hover:text-white text-sm font-medium transition-colors rounded-lg cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </>,
    document.body
  );
}

interface AddressLinkProps {
  address: string;
  lat?: number;
  lng?: number;
  className?: string;
  children: React.ReactNode;
}

export function AddressLink({ address, lat, lng, className, children }: AddressLinkProps) {
  const [open, setOpen] = useState(false);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen(true);
  }, []);

  return (
    <>
      <button onClick={handleClick} className={`${className ?? ''} cursor-pointer text-left`}>
        {children}
      </button>
      <NavigationSheet
        isOpen={open}
        onClose={() => setOpen(false)}
        address={address}
        lat={lat}
        lng={lng}
      />
    </>
  );
}

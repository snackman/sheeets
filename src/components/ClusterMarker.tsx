'use client';

import { useCallback } from 'react';
import { Marker } from 'react-map-gl/mapbox';

interface ClusterMarkerProps {
  latitude: number;
  longitude: number;
  pointCount: number;
  onClick: () => void;
}

export function ClusterMarker({
  latitude,
  longitude,
  pointCount,
  onClick,
}: ClusterMarkerProps) {
  const size = pointCount < 10 ? 32 : pointCount < 50 ? 40 : 52;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  return (
    <Marker latitude={latitude} longitude={longitude}>
      <button
        className="flex items-center justify-center rounded-full border-2 border-orange-300/50 cursor-pointer transition-transform hover:scale-110"
        style={{
          width: size,
          height: size,
          backgroundColor: 'rgba(249, 115, 22, 0.75)',
        }}
        onClick={handleClick}
        aria-label={`Cluster of ${pointCount} events`}
      >
        <span className="text-white font-bold text-sm">{pointCount}</span>
      </button>
    </Marker>
  );
}

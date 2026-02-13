'use client';

import { useCallback } from 'react';
import { Marker } from 'react-map-gl/mapbox';

interface MapMarkerProps {
  latitude: number;
  longitude: number;
  startMinutes?: number | null;
  endMinutes?: number | null;
  isAllDay?: boolean;
  eventCount?: number;
  onClick: () => void;
  zoom?: number;
  label?: string;
  time?: string;
  orderNumber?: number;
}

/** Get pin color based on start hour: yellow (morning), orange (afternoon), purple (evening) */
function getPinColor(startMinutes: number | null | undefined): string {
  if (startMinutes == null) return '#F97316'; // default orange
  const hour = startMinutes / 60;
  if (hour < 12) return '#FBBF24'; // yellow — morning
  if (hour < 18) return '#F97316'; // orange — afternoon
  return '#A855F7'; // purple — evening
}

/** SVG clock-face pin with a black wedge representing the event time */
function ClockPin({
  startMinutes,
  endMinutes,
  isAllDay,
  size,
}: {
  startMinutes?: number | null;
  endMinutes?: number | null;
  isAllDay?: boolean;
  size: number;
}) {
  const color = getPinColor(startMinutes);
  const r = size / 2;
  const cx = r;
  const cy = r;
  const ir = r - 1; // inner radius (inset for stroke)

  // All-day or no time: solid colored circle
  if (isAllDay || startMinutes == null) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={ir} fill={color} />
        <circle cx={cx} cy={cy} r={ir} fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
      </svg>
    );
  }

  const end = endMinutes ?? startMinutes + 60;

  // Convert minutes-since-midnight to 12-hour clock angle (0° = 12 o'clock, clockwise)
  const startAngle = ((startMinutes % 720) / 720) * 360;
  const endAngle = ((end % 720) / 720) * 360;

  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 360;
  if (sweep > 360) sweep = 360;

  const toXY = (deg: number) => ({
    x: cx + ir * Math.sin((deg * Math.PI) / 180),
    y: cy - ir * Math.cos((deg * Math.PI) / 180),
  });

  const s = toXY(startAngle);
  const e = toXY(endAngle);
  const largeArc = sweep > 180 ? 1 : 0;

  const wedgePath = `M ${cx} ${cy} L ${s.x} ${s.y} A ${ir} ${ir} 0 ${largeArc} 1 ${e.x} ${e.y} Z`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={ir} fill={color} />
      <path d={wedgePath} fill="black" fillOpacity={0.6} />
      <circle cx={cx} cy={cy} r={ir} fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
    </svg>
  );
}

export function MapMarker({
  latitude,
  longitude,
  startMinutes,
  endMinutes,
  isAllDay,
  eventCount = 1,
  onClick,
  zoom = 12,
  label,
  time,
  orderNumber,
}: MapMarkerProps) {
  const color = getPinColor(startMinutes);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  const showLabel = zoom >= 14 && label;
  const showTime = zoom >= 16 && time;
  const isNumbered = orderNumber != null;

  return (
    <Marker latitude={latitude} longitude={longitude}>
      <button
        className="relative flex flex-col items-center cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none p-2"
        onClick={handleClick}
        aria-label={`Event${eventCount > 1 ? ` (${eventCount} events)` : ''}`}
      >
        <div className="relative flex items-center justify-center">
          {isNumbered ? (
            /* Itinerary mode: numbered circle with time-based color */
            <div
              className="rounded-full border-2 border-white/80 flex items-center justify-center text-white font-bold text-[10px] leading-none"
              style={{
                width: 22,
                height: 22,
                backgroundColor: color,
                boxShadow: `0 0 6px ${color}80`,
              }}
            >
              {orderNumber}
            </div>
          ) : (
            /* Clock-face pin */
            <div style={{ boxShadow: `0 0 6px ${color}80` }} className="rounded-full">
              <ClockPin
                startMinutes={startMinutes}
                endMinutes={endMinutes}
                isAllDay={isAllDay}
                size={22}
              />
            </div>
          )}
          {/* Event count badge for multi-event locations */}
          {!isNumbered && eventCount > 1 && (
            <span
              className="absolute -top-1 -right-2 bg-white text-gray-900 text-[9px] font-bold rounded-full flex items-center justify-center"
              style={{ width: 16, height: 16 }}
            >
              {eventCount}
            </span>
          )}
        </div>

        {/* Label card (zoom >= 14) */}
        {showLabel && (
          <div className="mt-0.5 px-1.5 py-0.5 rounded bg-slate-800/90 text-[10px] text-white max-w-[120px] truncate whitespace-nowrap leading-tight pointer-events-none">
            {label}
            {showTime && (
              <span className="ml-1 text-slate-400">{time}</span>
            )}
          </div>
        )}
      </button>
    </Marker>
  );
}

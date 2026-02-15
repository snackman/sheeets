'use client';

import { useCallback } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import { TagBadge } from './TagBadge';

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
  organizer?: string;
  tags?: string[];
  orderNumber?: number;
  labelOffsetX?: number;
  labelOffsetY?: number;
  showLeaderLine?: boolean;
}

/** Get pin color based on start hour: white (morning/afternoon), transparent white (evening) */
function getPinColor(startMinutes: number | null | undefined): string {
  if (startMinutes == null) return '#FFFFFF'; // default white
  const hour = startMinutes / 60;
  if (hour < 12) return '#FFFFFF'; // white — morning
  if (hour < 18) return '#FFFFFF'; // white — afternoon
  return 'rgba(255,255,255,0.4)'; // transparent white — evening
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
        {/* Clock tick marks at 12, 3, 6, 9 */}
        <line x1={cx} y1={cy - ir} x2={cx} y2={cy - ir + 3} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
        <line x1={cx + ir} y1={cy} x2={cx + ir - 3} y2={cy} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
        <line x1={cx} y1={cy + ir} x2={cx} y2={cy + ir - 3} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
        <line x1={cx - ir} y1={cy} x2={cx - ir + 3} y2={cy} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
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
      <circle cx={cx} cy={cy} r={ir} fill="#1e293b" />
      <path d={wedgePath} fill={color} />
      <circle cx={cx} cy={cy} r={ir} fill="none" stroke="white" strokeWidth={1.5} strokeOpacity={0.8} />
      {/* Clock tick marks at 12, 3, 6, 9 */}
      <line x1={cx} y1={cy - ir} x2={cx} y2={cy - ir + 3} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
      <line x1={cx + ir} y1={cy} x2={cx + ir - 3} y2={cy} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
      <line x1={cx} y1={cy + ir} x2={cx} y2={cy + ir - 3} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
      <line x1={cx - ir} y1={cy} x2={cx - ir + 3} y2={cy} stroke="white" strokeWidth={1} strokeOpacity={0.7} />
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
  organizer,
  tags,
  orderNumber,
  labelOffsetX = 91,
  labelOffsetY = -14,
  showLeaderLine = false,
}: MapMarkerProps) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick();
    },
    [onClick]
  );

  const showLabel = !!label && zoom >= 11.5;
  const isNumbered = orderNumber != null;
  const showOrganizer = zoom >= 14.4;
  const showTagIcons = zoom >= 15;

  return (
    <Marker latitude={latitude} longitude={longitude}>
      {/* Zero-size anchor at lat/lng; everything positioned absolutely from here */}
      <div className="relative" style={{ width: 0, height: 0 }}>
        {/* Clickable pin */}
        <button
          className="absolute cursor-pointer transition-transform hover:scale-110 active:scale-95 focus:outline-none p-2"
          style={{ transform: 'translate(-50%, -50%)' }}
          onClick={handleClick}
          aria-label={`Event${eventCount > 1 ? ` (${eventCount} events)` : ''}`}
        >
          <div className="relative flex items-center justify-center">
            {/* Clock-face pin */}
            <div className="rounded-full">
              <ClockPin
                startMinutes={startMinutes}
                endMinutes={endMinutes}
                isAllDay={isAllDay}
                size={19}
              />
            </div>
            {/* Badge: itinerary stop number or multi-event count */}
            {isNumbered ? (
              <span
                className="absolute -top-1.5 -right-3 bg-white text-gray-900 text-[9px] font-bold rounded-full flex items-center justify-center"
                style={{ minWidth: 20, height: 18, padding: '0 3px' }}
              >
                #{orderNumber}
              </span>
            ) : eventCount > 1 ? (
              <span
                className="absolute -top-1 -right-2 bg-white text-gray-900 text-[9px] font-bold rounded-full flex items-center justify-center"
                style={{ width: 16, height: 16 }}
              >
                {eventCount}
              </span>
            ) : null}
          </div>
        </button>

        {/* Leader line from pin center to label */}
        {showLabel && showLeaderLine && (
          <svg
            className="absolute overflow-visible pointer-events-none"
            style={{ left: 0, top: 0, width: 0, height: 0 }}
          >
            <line
              x1={0}
              y1={0}
              x2={labelOffsetX}
              y2={labelOffsetY}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
            />
          </svg>
        )}

        {/* Label card */}
        {showLabel && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: labelOffsetX,
              top: labelOffsetY,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="px-1.5 py-0.5 rounded bg-slate-800/90 text-[10px] text-white max-w-[140px] leading-tight">
              <div className="truncate whitespace-nowrap">{label}</div>
              {showOrganizer && organizer && (
                <div className="truncate whitespace-nowrap text-slate-400">{organizer}</div>
              )}
              {showTagIcons && tags && tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-0.5 mt-0.5">
                  {tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} iconOnly iconClassName="w-[15px] h-[15px]" />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Marker>
  );
}

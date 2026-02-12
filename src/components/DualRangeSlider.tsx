'use client';

import { useRef, useCallback } from 'react';

interface DualRangeSliderProps {
  min: number;
  max: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  color?: string; // tailwind color for track/thumb e.g. 'orange' or 'blue'
}

export function DualRangeSlider({
  min,
  max,
  start,
  end,
  onChange,
  color = 'orange',
}: DualRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  const range = max - min;

  const valueToPercent = (v: number) => ((v - min) / range) * 100;

  const clientXToValue = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return min;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return Math.round(ratio * range + min);
    },
    [min, range],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const track = trackRef.current;
      if (!track) return;

      track.setPointerCapture(e.pointerId);
      const val = clientXToValue(e.clientX);

      if (start === end) {
        // Handles overlapping: pick based on which side of the handle the click is
        // If clicking exactly on them, defer to first move direction
        if (val > start) {
          draggingRef.current = 'end';
          onChange(start, Math.max(val, start));
        } else if (val < start) {
          draggingRef.current = 'start';
          onChange(Math.min(val, end), end);
        } else {
          // Exactly on the overlap — will resolve on first move
          draggingRef.current = null;
        }
      } else {
        // Pick nearest handle
        const distToStart = Math.abs(val - start);
        const distToEnd = Math.abs(val - end);
        if (distToStart <= distToEnd) {
          draggingRef.current = 'start';
          onChange(Math.min(val, end), end);
        } else {
          draggingRef.current = 'end';
          onChange(start, Math.max(val, start));
        }
      }
    },
    [start, end, onChange, clientXToValue],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!trackRef.current?.hasPointerCapture(e.pointerId)) return;

      const val = clientXToValue(e.clientX);

      if (draggingRef.current === null) {
        // Resolve direction for overlapping handles
        if (val > start) {
          draggingRef.current = 'end';
        } else if (val < start) {
          draggingRef.current = 'start';
        } else {
          return; // No movement yet
        }
      }

      if (draggingRef.current === 'start') {
        onChange(Math.min(val, end), end);
      } else {
        onChange(start, Math.max(val, start));
      }
    },
    [start, end, onChange, clientXToValue],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (trackRef.current?.hasPointerCapture(e.pointerId)) {
        trackRef.current.releasePointerCapture(e.pointerId);
      }
      draggingRef.current = null;
    },
    [],
  );

  const thumbClasses =
    color === 'blue'
      ? 'bg-blue-500 border-white'
      : 'bg-orange-500 border-white';

  const trackFillColor =
    color === 'blue' ? 'bg-blue-500' : 'bg-orange-500';

  return (
    <div
      ref={trackRef}
      className="relative h-8 flex items-center cursor-pointer touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* Background track */}
      <div className="absolute w-full h-1.5 bg-slate-700 rounded-full" />
      {/* Active range fill */}
      <div
        className={`absolute h-1.5 ${trackFillColor} rounded-full`}
        style={{
          left: `${valueToPercent(start)}%`,
          right: `${100 - valueToPercent(end)}%`,
        }}
      />
      {/* Start thumb */}
      <div
        className={`absolute w-4 h-4 rounded-full border-2 shadow-md ${thumbClasses}`}
        style={{
          left: `${valueToPercent(start)}%`,
          transform: 'translateX(-50%)',
        }}
      />
      {/* End thumb */}
      <div
        className={`absolute w-4 h-4 rounded-full border-2 shadow-md ${thumbClasses}`}
        style={{
          left: `${valueToPercent(end)}%`,
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
}

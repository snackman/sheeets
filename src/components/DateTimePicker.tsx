'use client';

import { useState, useRef, useEffect } from 'react';

// Generate time options in 30-minute intervals
const TIME_OPTIONS: string[] = [];
for (let hour = 0; hour < 24; hour++) {
  for (let minute = 0; minute < 60; minute += 30) {
    TIME_OPTIONS.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
}

function format12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Scroll selected option into view when dropdown opens
  useEffect(() => {
    if (isOpen && listRef.current) {
      const selected = listRef.current.querySelector('[data-selected="true"]');
      if (selected) selected.scrollIntoView({ block: 'center' });
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="bg-slate-700 border border-slate-600 rounded text-white text-sm font-medium px-2 py-1.5 focus:border-orange-500 focus:outline-none cursor-pointer whitespace-nowrap hover:bg-slate-600 transition-colors"
      >
        {format12Hour(value)}
      </button>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute top-full left-0 mt-1 w-[110px] bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-52 overflow-y-auto z-50"
        >
          {TIME_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              data-selected={t === value}
              onClick={() => { onChange(t); setIsOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                t === value
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              {format12Hour(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Custom datetime picker: native date input + 30-min time dropdown */
export function DateTimePicker({
  value,
  min,
  max,
  onChange,
}: {
  value: string; // "YYYY-MM-DDTHH:mm"
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const [date, time] = value.split('T');
  const timeVal = time ?? '00:00';
  const minDate = min?.split('T')[0];
  const maxDate = max?.split('T')[0];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input
        type="date"
        value={date}
        min={minDate}
        max={maxDate}
        onChange={(e) => e.target.value && onChange(`${e.target.value}T${timeVal}`)}
        className="bg-slate-700 border border-slate-600 rounded text-white text-sm font-medium px-2 py-1.5 focus:border-orange-500 focus:outline-none cursor-pointer [color-scheme:dark]"
      />
      <TimePicker
        value={timeVal}
        onChange={(t) => onChange(`${date}T${t}`)}
      />
    </div>
  );
}

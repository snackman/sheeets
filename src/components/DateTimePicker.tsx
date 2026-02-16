'use client';

import { useState, useRef, useEffect } from 'react';
import { EVENT_DATES } from '@/lib/constants';

// Generate time options in 30-minute intervals
const TIME_OPTIONS: string[] = [];
for (let hour = 0; hour < 24; hour++) {
  for (let minute = 0; minute < 60; minute += 30) {
    TIME_OPTIONS.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateShort(iso: string): string {
  // "2026-02-16" → "Feb 16"
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function format12Hour(time24: string): string {
  const [hours, minutes] = time24.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
}

function Dropdown({
  value,
  options,
  renderOption,
  renderSelected,
  onChange,
  width,
}: {
  value: string;
  options: string[];
  renderOption: (v: string) => string;
  renderSelected: (v: string) => string;
  onChange: (v: string) => void;
  width?: string;
}) {
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
        {renderSelected(value)}
      </button>

      {isOpen && (
        <div
          ref={listRef}
          className="absolute top-full left-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-52 overflow-y-auto z-50"
          style={width ? { width } : undefined}
        >
          {options.map((v) => (
            <button
              key={v}
              type="button"
              data-selected={v === value}
              onClick={() => { onChange(v); setIsOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                v === value
                  ? 'bg-orange-500 text-white font-medium'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              {renderOption(v)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Custom datetime picker: date dropdown (Feb 16) + 30-min time dropdown */
export function DateTimePicker({
  value,
  onChange,
}: {
  value: string; // "YYYY-MM-DDTHH:mm"
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const [date, time] = value.split('T');
  const timeVal = time ?? '00:00';

  return (
    <div className="flex items-center gap-1">
      <Dropdown
        value={date}
        options={EVENT_DATES}
        renderOption={formatDateShort}
        renderSelected={formatDateShort}
        onChange={(d) => onChange(`${d}T${timeVal}`)}
        width="90px"
      />
      <Dropdown
        value={timeVal}
        options={TIME_OPTIONS}
        renderOption={format12Hour}
        renderSelected={format12Hour}
        onChange={(t) => onChange(`${date}T${t}`)}
        width="110px"
      />
    </div>
  );
}

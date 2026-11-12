'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Clock, Check } from 'lucide-react';
import type { FilterState } from '@/lib/types';

type TimeMode = FilterState['timeMode'];

export const TIME_OPTIONS: { value: TimeMode; label: string; short: string }[] = [
  { value: 'off', label: 'Any time', short: 'Any' },
  { value: 'now', label: 'Happening now', short: 'Now' },
  { value: 'today', label: 'Today', short: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow', short: 'Tomorrow' },
];

interface TimeFilterProps {
  value: TimeMode;
  onChange: (mode: TimeMode) => void;
}

/** Visible time filter: a button showing the current choice that opens an Any / Now / Today / Tomorrow menu. */
export function TimeFilter({ value, onChange }: TimeFilterProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = TIME_OPTIONS.find((o) => o.value === value) ?? TIME_OPTIONS[0];
  const active = value !== 'off';

  useEffect(() => {
    if (!open) return;
    const selected = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    selected?.focus();
  }, [open]);

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) btnRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Time filter: ${current.label}`}
        className={clsx(
          'flex items-center gap-1 px-2.5 h-9 tap:h-11 tap:min-w-11 justify-center rounded-lg text-sm font-semibold transition-colors cursor-pointer border',
          active || open
            ? 'text-[var(--theme-filter-active)] border-[var(--theme-filter-active)]'
            : 'bg-[var(--theme-filter-control-bg)] text-[var(--theme-filter-text)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] active:text-[var(--theme-text-primary)] active:bg-[var(--theme-bg-tertiary)] border-[var(--theme-filter-control-border)]',
        )}
        style={active || open ? { backgroundColor: 'var(--theme-filter-active-bg)' } : undefined}
      >
        <Clock className="w-4 h-4" aria-hidden="true" />
        {active && <span className="text-xs">{current.short}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[var(--z-dropdown-backdrop)]" onClick={() => close(false)} aria-hidden="true" />
          <div
            ref={menuRef}
            role="menu"
            aria-label="Time filter"
            onKeyDown={onMenuKeyDown}
            className="absolute right-0 top-full mt-1 z-[var(--z-dropdown)] min-w-[200px] overflow-hidden rounded-lg border border-[var(--theme-border-primary)] bg-[var(--theme-bg-secondary)] shadow-xl"
          >
            {TIME_OPTIONS.map((o) => {
              const checked = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                  className={clsx(
                    'flex w-full items-center justify-between gap-3 px-4 min-h-11 text-left text-sm font-semibold transition-colors cursor-pointer',
                    checked
                      ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-text)]'
                      : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]',
                  )}
                >
                  {o.label}
                  {checked && <Check className="w-4 h-4" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

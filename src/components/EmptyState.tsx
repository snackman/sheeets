import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  title: string;
  description?: ReactNode;
  /** Optional extra content (filter chips, actions). */
  children?: ReactNode;
  /** Vertical padding preset: the full-page lists use "page", side panels use "panel". */
  size?: 'page' | 'panel';
}

/** One shared empty/error state: icon, title, description and optional actions. */
export function EmptyState({ icon: Icon, title, description, children, size = 'page' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-4 text-center ${size === 'page' ? 'py-20' : 'py-16'}`}
    >
      <Icon className="w-12 h-12 text-[var(--theme-text-faint)] mb-4" aria-hidden="true" />
      <p className="text-lg font-medium text-[var(--theme-text-secondary)]">{title}</p>
      {description && <p className="text-sm mt-1 max-w-xs text-[var(--theme-text-muted)]">{description}</p>}
      {children}
    </div>
  );
}

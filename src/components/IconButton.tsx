import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** Required accessible name. */
  'aria-label': string;
  /** Toggle state, when the button is a toggle. */
  'aria-pressed'?: boolean;
  children: ReactNode;
}

/**
 * Icon-only button with a >= 44px hit area (min-h-11 min-w-11). Callers add
 * their own visual styling; the hit area stays large regardless of icon size.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, type = 'button', children, ...rest },
  ref,
) {
  if (process.env.NODE_ENV !== 'production' && !rest['aria-label']) {
    console.error('IconButton requires a non-empty aria-label');
  }
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center shrink-0 rounded-lg cursor-pointer transition-colors min-h-11 min-w-11',
        'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-primary)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

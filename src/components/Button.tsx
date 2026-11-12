import { forwardRef, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-hover)] active:bg-[var(--theme-accent-hover)] text-[var(--theme-accent-text)] border border-transparent',
  secondary:
    'bg-transparent text-[var(--theme-text-secondary)] border border-[var(--theme-border-primary)] hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text-primary)]',
  ghost:
    'bg-transparent text-[var(--theme-text-secondary)] border border-transparent hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text-primary)]',
  danger: 'bg-danger hover:bg-danger-hover active:bg-danger-hover text-danger-on border border-transparent',
};

// `sm` is compact on desktop (sm: breakpoint) but keeps a 44px touch target on mobile; `md` is 44px everywhere.
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-11 sm:min-h-8 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});

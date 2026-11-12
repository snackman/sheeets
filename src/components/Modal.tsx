'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, topmost last: only the top one reacts to Escape / traps focus.
const stack: symbol[] = [];
let lockCount = 0;
let prevOverflow = '';

function lockScroll() {
  if (lockCount++ === 0) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}
function unlockScroll() {
  if (--lockCount === 0) document.body.style.overflow = prevOverflow;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** id of the element that titles the dialog. Provide this or ariaLabel. */
  labelledBy?: string;
  ariaLabel?: string;
  /** Classes for the dialog panel (width, background, radius...). */
  className?: string;
  /** Classes for the full-screen overlay (default: centered with padding). */
  containerClassName?: string;
  /** Overlay tint. Default bg-black/50. */
  backdropClassName?: string;
  /** Element to focus on open; defaults to [data-autofocus], then the first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

/**
 * Accessible modal dialog: portal, role=dialog + aria-modal, focus trap,
 * initial focus, focus return, Escape, scroll lock and backdrop click.
 * Mount it only while open (`{open && <Modal ...>}`).
 */
export function Modal({
  onClose,
  children,
  labelledBy,
  ariaLabel,
  className = '',
  containerClassName = 'items-center justify-center p-4',
  backdropClassName = 'bg-black/50',
  initialFocusRef,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const id = Symbol('modal');
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();

    const panel = panelRef.current!;
    const target =
      initialFocusRef?.current ??
      panel.querySelector<HTMLElement>('[data-autofocus]') ??
      focusables(panel)[0] ??
      panel;
    target.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      unlockScroll();
      if (opener && opener.isConnected && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[var(--z-modal)] flex ${backdropClassName} ${containerClassName}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
      data-modal-backdrop
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        tabIndex={-1}
        className={`outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

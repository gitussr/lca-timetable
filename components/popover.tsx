'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A small anchored dialog.
 *
 * §21 asks for controlled editing that keeps the timetable readable, and §39
 * warns against burying the work in modals. A popover anchored to the thing you
 * clicked keeps the grid visible behind it, so you can see the row you are
 * editing while you edit it.
 *
 * Accessible modal behaviour (§46): labelled dialog role, focus moved in on
 * open and restored on close, Escape closes, Tab is kept inside while open.
 */
export default function Popover({
  anchor,
  title,
  onClose,
  children,
}: {
  anchor: DOMRect;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });

  // Measure after paint, then clamp inside the viewport so a cell near the
  // right or bottom edge does not open a popover off screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;

    let left = anchor.left;
    let top = anchor.bottom + 6;

    if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
    if (left < margin) left = margin;
    // Flip above the anchor when there is no room below.
    if (top + height > window.innerHeight - margin) {
      const above = anchor.top - height - 6;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
    }
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus the first control so keyboard users land inside the dialog.
    const first = el?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-skip-focus])',
    );
    (first ?? el)?.focus();

    return () => {
      // Return focus to whatever opened it, not to the top of the document.
      restoreFocusTo.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const el = ref.current;
      if (!el) return;
      const focusable = [
        ...el.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((n) => n.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  return (
    <>
      {/*
        A button, not a div: clicking away closes, and it stays out of the tab
        order so it never sits between the dialog's own controls.
      */}
      <button
        type="button"
        className="pop-backdrop"
        aria-label="Close"
        tabIndex={-1}
        data-skip-focus
        onClick={onClose}
      />
      <div
        ref={ref}
        className="pop"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ top: pos.top, left: pos.left }}
      >
        {children}
      </div>
    </>
  );
}

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export type RowAction = {
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
};

/**
 * Compact ⋯ menu for FleetDataGrid action columns.
 *
 * Positioning: the popover uses `position: fixed` anchored to the trigger's
 * viewport rect (via getBoundingClientRect). This escapes ancestor clipping
 * — FleetDataGrid wraps rows in overflow-hidden + overflow-x-auto, so an
 * absolutely-positioned menu was getting cropped at the grid edges.
 *
 * Auto-flips above the trigger when there isn't room below.
 * Auto-shifts left when it would overflow the right viewport edge.
 * Closes on outside click, Escape, scroll (capture — catches nested
 * scrollers), and resize.
 */
export default function RowActionsMenu({
  actions,
  label = 'Row actions',
  width = 176,
}: {
  actions: RowAction[];
  label?: string;
  /** Menu width in px; default 176 (10rem). */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Approximate menu height so we know whether to flip. ~34px per action
    // + 8px vertical padding matches the py-2 button + py-1 container below.
    const menuH = actions.length * 34 + 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuH + 8 ? rect.bottom + 4 : Math.max(8, rect.top - menuH - 4);
    // Right-align the menu with the trigger, clamped inside the viewport.
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    setPos({ top, left });
  }, [actions.length, width]);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // `capture` picks up scroll on nested scrollers (e.g. the grid's
    // overflow-x-auto region) — otherwise the menu would drift with the
    // row instead of closing.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text-main)]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="z-50 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] py-1 shadow-2xl"
        >
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
              className={`block w-full px-3 py-2 text-left text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                a.tone === 'danger' ? 'text-rose-300 hover:bg-rose-500/10' : 'text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

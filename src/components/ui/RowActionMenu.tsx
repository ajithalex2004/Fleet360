'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

type RowActionItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'success' | 'info' | 'accent' | 'warning';
};

export default function RowActionMenu({
  actions,
  side = 'bottom',
}: {
  actions: RowActionItem[];
  side?: 'top' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; ready: boolean }>({ top: 0, left: 0, ready: false });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      const menuRect = menuRef.current?.getBoundingClientRect();
      if (!rect || !menuRect) return;
      const menuWidth = menuRect.width;
      const menuHeight = menuRect.height;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let left = rect.right - menuWidth;
      left = Math.max(12, Math.min(left, viewportWidth - menuWidth - 12));

      let top = side === 'top' ? rect.top - menuHeight - 8 : rect.bottom + 8;
      if (side === 'top' && top < 12) top = rect.bottom + 8;
      if (side === 'bottom' && top + menuHeight > viewportHeight - 12) {
        top = Math.max(12, rect.top - menuHeight - 8);
      }

      setMenuPosition({ top, left, ready: true });
    };

    setMenuPosition((current) => ({ ...current, ready: false }));
    updatePosition();
    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [actions.length, open, side]);

  const toneClassMap: Record<NonNullable<RowActionItem['tone']>, string> = {
    default: 'border-slate-300 bg-slate-100 text-slate-800 hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900',
    danger: 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100 hover:text-rose-800',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-100 hover:text-emerald-800',
    info: 'border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-400 hover:bg-sky-100 hover:text-sky-800',
    accent: 'border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100 hover:text-violet-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-800',
  };

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative inline-flex justify-end">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && mounted && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] min-w-[200px] rounded-xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl"
          style={{
            top: menuPosition.top,
            left: menuPosition.left,
            opacity: menuPosition.ready ? 1 : 0,
            pointerEvents: menuPosition.ready ? 'auto' : 'none',
          }}
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={() => {
                if (action.disabled) return;
                setOpen(false);
                action.onSelect();
              }}
              className={`mb-1 flex min-h-8 w-full items-center rounded-full border px-3 py-1.5 text-left text-xs font-semibold transition last:mb-0 ${toneClassMap[action.tone ?? 'default']} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

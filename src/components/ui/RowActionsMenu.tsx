'use client';
/**
 * RowActionsMenu — kebab (⋯) trigger that opens a popover of row actions.
 *
 * Designed for the trailing "actions" cell of a data grid where a fat button
 * strip (Edit / Stops / Optimize / Deactivate / Delete) crowds the row. The
 * kebab keeps the row visually clean; the popover surfaces the same set with
 * icons and disabled-with-reason tooltips.
 *
 * Positioning: anchors to the trigger's viewport rect via `position: fixed`,
 * so it doesn't get clipped by the grid's overflow-x-auto. Closes on outside
 * click, Escape, and window scroll/resize.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface RowAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  /** Tooltip shown on hover when disabled. */
  disabledReason?: string;
}

interface RowActionsMenuProps {
  actions: RowAction[];
  /** Menu width in px; default 176. */
  width?: number;
  /** aria-label for the trigger button. Include row context so screen readers can distinguish rows. */
  triggerLabel?: string;
}

export default function RowActionsMenu({ actions, width = 176, triggerLabel = 'Row actions' }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Anchor top edge to bottom of trigger, right-align with trigger.
    // If the menu would overflow the bottom, flip above.
    const menuH = actions.length * 34 + 8; // approx
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= menuH + 8 ? rect.bottom + 4 : rect.top - menuH - 4;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
    setPos({ top, left });
  }, [actions.length, width]);

  useEffect(() => {
    if (!open) return;
    place();
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, place]);

  const runAction = (action: RowAction) => {
    if (action.disabled) return;
    setOpen(false);
    action.onClick();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={`inline-flex items-center justify-center rounded-lg border w-8 h-8 transition-colors ${
          open
            ? 'border-violet-500/40 bg-violet-500/10 text-violet-200'
            : 'border-white/10 text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
          className="z-50 rounded-xl border border-white/10 bg-slate-900 shadow-2xl p-1"
        >
          {actions.map(action => {
            const Icon = action.icon;
            const destructive = action.variant === 'destructive';
            return (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                title={action.disabled ? action.disabledReason : undefined}
                onClick={() => runAction(action)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  destructive
                    ? 'text-rose-300 hover:bg-rose-500/10 disabled:hover:bg-transparent'
                    : 'text-slate-200 hover:bg-white/5 disabled:hover:bg-transparent'
                }`}
              >
                {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${destructive ? 'text-rose-400' : 'text-slate-400'}`} />}
                <span className="flex-1">{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

'use client';

import type { ReactNode } from 'react';

type ActionDialogTone = 'danger' | 'warning' | 'info';

interface ActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ActionDialogTone;
  busy?: boolean;
  showCancel?: boolean;
  details?: string[];
  children?: ReactNode;
}

const TONE_STYLES: Record<ActionDialogTone, { accent: string; button: string }> = {
  danger: {
    accent: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    button: 'border border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400 hover:bg-rose-100',
  },
  warning: {
    accent: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    button: 'border border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400 hover:bg-amber-100',
  },
  info: {
    accent: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
    button: 'border border-cyan-300 bg-cyan-50 text-cyan-700 hover:border-cyan-400 hover:bg-cyan-100',
  },
};

export default function ActionDialog({
  open,
  title,
  description,
  onClose,
  onConfirm,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'info',
  busy = false,
  showCancel = true,
  details,
  children,
}: ActionDialogProps) {
  if (!open) return null;

  const styles = TONE_STYLES[tone];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-300">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-2xl leading-none text-slate-500 hover:text-white"
            aria-label="Close dialog"
          >
            x
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {details && details.length > 0 && (
            <div className={`rounded-xl border px-4 py-3 ${styles.accent}`}>
              <ul className="space-y-2 text-sm">
                {details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          )}
          {children}
        </div>

        <div className="flex justify-end gap-3 border-t border-white/10 px-6 py-4">
          {showCancel && (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          {onConfirm && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              className={`rounded-lg px-5 py-2 text-sm font-semibold transition disabled:opacity-50 ${styles.button}`}
            >
              {busy ? 'Working...' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

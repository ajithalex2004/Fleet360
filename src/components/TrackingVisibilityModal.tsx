'use client';

/**
 * TrackingVisibilityModal — operator picks one of the four levels and
 * optionally adds a reason. Reused everywhere visibility is set:
 *   • Per-shipment override (logistics shipment detail pages)
 *   • Per-customer default (customer detail page)
 *   • Tenant default (admin/shipper-portal-config page)
 *
 * The component is purely presentational — it doesn't know which API
 * to call. Caller passes `onSave({ level, reason })` and handles the
 * fetch + error toast.
 *
 * Downgrade detection: if the new level is "weaker" than the current,
 * the reason field is prompted more prominently (still optional in the
 * UI to avoid blocking the operator; the audit log captures the change
 * either way).
 */

import { useMemo, useState } from 'react';
import {
  X, AlertCircle, ShieldOff, Lock, Activity, Navigation, Eye, Trash2,
} from 'lucide-react';
import {
  TRACKING_LEVELS,
  type TrackingLevel,
} from '@/lib/shipper-portal/visibility';

interface LevelOption {
  value: TrackingLevel;
  label: string;
  description: string;
  rank: number;                       // 0-3 for downgrade detection
  icon: React.ComponentType<{ className?: string }>;
  tone: string;                       // Tailwind classes
}

const OPTIONS: LevelOption[] = [
  {
    value: 'NONE', label: 'Notifications only', rank: 0,
    description: 'Shipper sees only terminal events — submitted, acknowledged, delivered. No status timeline, no ETA, no carrier identity.',
    icon: ShieldOff,
    tone: 'border-slate-500/40 bg-slate-500/5 hover:bg-slate-500/10',
  },
  {
    value: 'STATUS_ONLY', label: 'Status updates', rank: 1,
    description: 'Full status timeline, origin & destination, cargo summary, expected cost. No ETA, no live GPS, no carrier name.',
    icon: Eye,
    tone: 'border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10',
  },
  {
    value: 'STATUS_AND_ETA', label: 'Status + ETA', rank: 2,
    description: 'Above + estimated delivery time + planned route. Still no live GPS or carrier identity.',
    icon: Navigation,
    tone: 'border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10',
  },
  {
    value: 'FULL_TRACKING', label: 'Live tracking', rank: 3,
    description: 'Everything above + live GPS location + driver name & phone + vehicle plate + carrier name.',
    icon: Activity,
    tone: 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10',
  },
];

const RANK_BY_LEVEL: Record<TrackingLevel, number> = Object.fromEntries(
  OPTIONS.map(o => [o.value, o.rank]),
) as Record<TrackingLevel, number>;

export interface TrackingVisibilityModalProps {
  /** Heading text — context tells the operator what they're editing. */
  title: string;
  /** Sub-headline beneath the title — e.g. "Shipment SH-2026-1042" or "Default for ACME Trading". */
  subtitle?: string;
  /** The current effective level. Used for downgrade detection. */
  currentLevel: TrackingLevel;
  /** If true, show a "Clear override → revert to inherited" button. Only
   *  meaningful for per-shipment overrides. */
  allowClear?: boolean;
  /** Called on save. Caller does the actual API mutation. */
  onSave: (args: { level: TrackingLevel | null; reason: string | null }) => Promise<void>;
  onClose: () => void;
}

export function TrackingVisibilityModal({
  title, subtitle, currentLevel, allowClear, onSave, onClose,
}: TrackingVisibilityModalProps) {
  const [selected, setSelected] = useState<TrackingLevel>(currentLevel);
  const [reason, setReason]     = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  // Downgrade = selected rank is lower than current rank. We surface the
  // reason field more prominently in that case.
  const isDowngrade = useMemo(
    () => RANK_BY_LEVEL[selected] < RANK_BY_LEVEL[currentLevel],
    [selected, currentLevel],
  );

  const isNoChange = selected === currentLevel;

  const submit = async (clear: boolean = false) => {
    setBusy(true); setErr(null);
    try {
      await onSave({
        level: clear ? null : selected,
        reason: reason.trim() || null,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/10">
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose}
            className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — 4 radio cards */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-slate-500 mb-1">
            Choose what the shipper sees
          </p>
          {OPTIONS.map(opt => {
            const Icon = opt.icon;
            const checked = selected === opt.value;
            const isCurrent = currentLevel === opt.value;
            return (
              <button key={opt.value} type="button"
                onClick={() => setSelected(opt.value)}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  checked ? 'ring-2 ring-emerald-500/50 ' + opt.tone : opt.tone + ' border-white/10'
                }`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center ${
                    checked ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-white">{opt.label}</p>
                      {isCurrent && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      {opt.description}
                    </p>
                  </div>
                  <input type="radio"
                    checked={checked}
                    onChange={() => setSelected(opt.value)}
                    className="mt-1 w-4 h-4 accent-emerald-500" />
                </div>
              </button>
            );
          })}

          {/* Reason field — prominently shown for downgrades, modest otherwise */}
          {!isNoChange && (
            <div className={`mt-4 p-3 rounded-xl border ${
              isDowngrade
                ? 'bg-amber-500/5 border-amber-500/30'
                : 'bg-slate-800/30 border-white/5'
            }`}>
              <label className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 mb-1">
                {isDowngrade && <Lock className="w-3.5 h-3.5 text-amber-300" />}
                <span className={isDowngrade ? 'text-amber-200' : 'text-slate-400'}>
                  {isDowngrade ? 'Reason for reducing visibility' : 'Reason (optional)'}
                </span>
              </label>
              <textarea
                value={reason} onChange={e => setReason(e.target.value)}
                rows={2}
                placeholder={isDowngrade
                  ? 'Why is this shipper getting less information? (audit trail)'
                  : 'Add a note for the audit log (optional)'}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          )}

          {err && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-xs flex items-center gap-2 mt-3">
              <AlertCircle className="w-3.5 h-3.5" /> {err}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          {allowClear && (
            <button onClick={() => void submit(true)} disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-md disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Clear override
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} disabled={busy}
              className="px-3 py-2 text-sm text-slate-400 hover:text-white">
              Cancel
            </button>
            <button onClick={() => void submit(false)} disabled={busy || isNoChange}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {busy ? 'Saving…' : isNoChange ? 'No change' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Re-export so consumers don't need a second import line
export { TRACKING_LEVELS, type TrackingLevel } from '@/lib/shipper-portal/visibility';

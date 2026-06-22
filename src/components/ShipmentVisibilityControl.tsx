'use client';

/**
 * ShipmentVisibilityControl — drop-in operator widget for any logistics
 * shipment detail surface. Renders a compact "Shipper sees: <level>" pill
 * with an edit affordance; clicking opens the TrackingVisibilityModal and
 * persists the per-shipment override (with reason) to
 * /api/logistics/shipments/[id]/tracking-visibility.
 *
 * Usage (in an operator shipment detail page):
 *
 *   <ShipmentVisibilityControl
 *     shipmentId={shipment.id}
 *     shipmentNo={shipment.shipmentNo}
 *     effectiveLevel={shipment.portalTrackingLevel ?? 'STATUS_ONLY'}
 *     hasOverride={shipment.portalTrackingLevel != null}
 *   />
 *
 * Self-contained — manages its own modal + fetch + optimistic update.
 * The parent only needs to pass the current effective level.
 */

import { useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { TrackingVisibilityModal } from '@/components/TrackingVisibilityModal';
import type { TrackingLevel } from '@/lib/shipper-portal/visibility';

const LEVEL_LABEL: Record<TrackingLevel, string> = {
  NONE:           'Notifications only',
  STATUS_ONLY:    'Status updates',
  STATUS_AND_ETA: 'Status + ETA',
  FULL_TRACKING:  'Live tracking',
};
const LEVEL_TONE: Record<TrackingLevel, string> = {
  NONE:           'bg-slate-500/15 text-slate-300 border-slate-500/30',
  STATUS_ONLY:    'bg-blue-500/15 text-blue-300 border-blue-500/30',
  STATUS_AND_ETA: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  FULL_TRACKING:  'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export function ShipmentVisibilityControl({
  shipmentId,
  shipmentNo,
  effectiveLevel,
  hasOverride = false,
  onChanged,
  compact = false,
}: {
  shipmentId: string;
  shipmentNo?: string | null;
  effectiveLevel: TrackingLevel;
  /** True when this shipment has a per-shipment override (vs inheriting
   *  the customer default). Controls the "Clear override" affordance. */
  hasOverride?: boolean;
  /** Called after a successful save so the parent can refresh. Receives
   *  the new effective level. */
  onChanged?: (newLevel: TrackingLevel) => void;
  /** Compact = just the pill + pencil. Non-compact = labelled row. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<TrackingLevel>(effectiveLevel);
  const [overridden, setOverridden] = useState(hasOverride);

  const save = async (args: { level: TrackingLevel | null; reason: string | null }) => {
    const res = await fetch(`/api/logistics/shipments/${shipmentId}/tracking-visibility`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: args.level, reason: args.reason }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d?.error ?? 'Update failed');
    }
    const data = await res.json();
    const newLevel = (data.effectiveLevel ?? args.level ?? level) as TrackingLevel;
    setLevel(newLevel);
    setOverridden(data.shipmentOverride != null);
    onChanged?.(newLevel);
  };

  const pill = (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${LEVEL_TONE[level]}`}>
      <Eye className="w-3 h-3" /> {LEVEL_LABEL[level]}
      {!overridden && <span className="text-[9px] text-slate-500 italic ml-0.5">(inherited)</span>}
    </span>
  );

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 group"
          title="Change what the shipper sees">
          {pill}
          <Pencil className="w-3 h-3 text-slate-500 group-hover:text-emerald-400" />
        </button>
      ) : (
        <div className="inline-flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Shipper sees:</span>
          {pill}
          <button type="button" onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-emerald-300 hover:bg-emerald-500/10">
            <Pencil className="w-3 h-3" /> Change
          </button>
        </div>
      )}

      {open && (
        <TrackingVisibilityModal
          title="Tracking visibility for this shipment"
          subtitle={shipmentNo ? `Shipment ${shipmentNo}` : undefined}
          currentLevel={level}
          allowClear={overridden}
          onSave={save}
          onClose={() => setOpen(false)} />
      )}
    </>
  );
}

'use client';

/**
 * CargoClassificationPanel
 *
 * Shipper-declared cargo classification: haulage type (inland vs cross-border),
 * customs details (HS code / INCOTERMS / weights / value / origin), and hazmat
 * declaration (UN number/class/packing group + emergency contact).
 *
 * Single source of truth for all screens that show a shipment or a shipping
 * request. Reads from a jsonb `metadata` blob — the same one that flows from
 * the shipper portal → shipping_requests.metadata → shipment_orders.metadata
 * (mirrored on convert). Any surface with access to that jsonb can drop this
 * component in and get consistent presentation.
 *
 * Renders nothing when there is no classification data — so it's safe to
 * mount on legacy orders that never carried this metadata.
 */

import React from 'react';
import { Globe2, ShieldAlert } from 'lucide-react';

export interface CustomsMeta {
  cargoType?: string | null;
  hsCode?: string | null;
  netWeightKg?: number | null;
  grossWeightKg?: number | null;
  customsValue?: number | null;
  customsCurrency?: string | null;
  incoterms?: string | null;
  originCountry?: string | null;
}

export interface HazmatMeta {
  unNumber?: string | null;
  unClass?: string | null;
  packingGroup?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
}

export interface CargoClassificationMeta {
  haulage?: 'INLAND' | 'CROSS_BORDER' | null;
  customs?: CustomsMeta | null;
  hazmat?: HazmatMeta | null;
  // Allow the caller to pass a wider metadata bag without a cast; we ignore
  // everything except the three keys above.
  [k: string]: unknown;
}

interface Props {
  metadata: CargoClassificationMeta | null | undefined;
}

export default function CargoClassificationPanel({ metadata }: Props) {
  if (!metadata) return null;
  const haulage = metadata.haulage ?? null;
  const customs = metadata.customs ?? null;
  const hazmat  = metadata.hazmat  ?? null;

  // Only render when there is at least one structured piece to show. This
  // keeps legacy shipments (pre-metadata) rendering nothing rather than an
  // empty chrome box.
  const hasCustoms = customs && Object.values(customs).some(v => v !== null && v !== undefined && v !== '');
  const hasHazmat  = hazmat  && Object.values(hazmat).some(v => v !== null && v !== undefined && v !== '');
  if (!haulage && !hasCustoms && !hasHazmat) return null;

  const haulageChip = haulage === 'CROSS_BORDER'
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-blue-500/20 text-blue-300 border-blue-500/40"><Globe2 className="w-3 h-3" /> Cross-Border</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-slate-500/20 text-slate-300 border-slate-500/40"><Globe2 className="w-3 h-3" /> Inland</span>;

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-500">Cargo classification</span>
        {haulageChip}
        {hasHazmat && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-amber-500/20 text-amber-200 border-amber-500/40"><ShieldAlert className="w-3 h-3" /> Hazardous</span>}
      </div>

      {hasCustoms && customs && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.04] p-3">
          <div className="text-[10px] uppercase tracking-wider text-blue-200/80 mb-2">Customs</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {customs.cargoType         && <Kv label="Cargo type"      value={customs.cargoType} />}
            {customs.hsCode            && <Kv label="HS code"         value={customs.hsCode} />}
            {customs.originCountry     && <Kv label="Origin country"  value={customs.originCountry} />}
            {customs.incoterms         && <Kv label="INCOTERMS"       value={customs.incoterms} />}
            {customs.netWeightKg   != null && <Kv label="Net weight"    value={`${customs.netWeightKg} kg`} />}
            {customs.grossWeightKg != null && <Kv label="Gross weight"  value={`${customs.grossWeightKg} kg`} />}
            {customs.customsValue  != null && <Kv label="Customs value" value={`${customs.customsCurrency ?? ''} ${customs.customsValue.toLocaleString()}`.trim()} />}
          </div>
        </div>
      )}

      {hasHazmat && hazmat && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3">
          <div className="text-[10px] uppercase tracking-wider text-amber-200/80 mb-2">Hazardous / regulated</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {hazmat.unNumber      && <Kv label="UN number"     value={hazmat.unNumber} />}
            {hazmat.unClass       && <Kv label="UN class"      value={`Class ${hazmat.unClass}`} />}
            {hazmat.packingGroup  && <Kv label="Packing group" value={hazmat.packingGroup} />}
            {hazmat.emergencyContactName  && <Kv label="Emergency contact" value={hazmat.emergencyContactName} />}
            {hazmat.emergencyContactPhone && <Kv label="Emergency phone"   value={hazmat.emergencyContactPhone} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-slate-200 truncate">{value}</div>
    </div>
  );
}

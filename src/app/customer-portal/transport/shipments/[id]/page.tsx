'use client';

/**
 * Customer Portal — one Logistics shipment: route, windows, cargo, rate and
 * its status timeline; ETA, driver, vehicle and live position only when the
 * customer's tracking level allows (the server leaves them out otherwise).
 * Replaces the Shipper portal's shipment page.
 */

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, PackageOpen, MapPin, Clock, UserRound, Phone, Car, Navigation, Loader2, Eye } from 'lucide-react';
import { Panel } from '@/components/ui/page-theme';
import { FormAlert } from '@/components/ui/form-kit';
import { fmtDateTime } from '../../transport-shared';
import {
  fmtMoney, shipmentStatusLabel, shipmentStatusTone, TRACKING_LABEL, type ShipmentDetail,
} from '../shipments-shared';

function place(p: ShipmentDetail['origin']): string {
  if (!p) return '—';
  return [p.name, p.address, p.city, p.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '—';
}
const range = (a?: string | null, b?: string | null) => (a ? `${fmtDateTime(a)}${b ? ` – ${fmtDateTime(b)}` : ''}` : '—');

export default function CustomerShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<ShipmentDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/shipper-portal/shipments/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (!res.ok) { setErr(res.status === 404 ? 'Shipment not found' : d?.error ?? 'Could not load the shipment'); return; }
      setS(d);
    })();
  }, [id]);

  const back = (
    <Link href="/customer-portal/transport/shipments" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline">
      <ArrowLeft className="w-3.5 h-3.5" /> All shipments
    </Link>
  );
  if (err) return <div className="space-y-3">{back}<FormAlert>{err}</FormAlert></div>;
  if (!s) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>;

  const tiles: Array<[string, string]> = [
    ['Pickup window', range(s.pickupWindowFrom, s.pickupWindowTo)],
    ['Delivery window', range(s.deliveryWindowFrom, s.deliveryWindowTo)],
    ['Weight / volume', [s.totalWeightKg != null ? `${s.totalWeightKg} kg` : null, s.totalVolumeCbm != null ? `${s.totalVolumeCbm} m³` : null].filter(Boolean).join(' · ') || '—'],
    ['Rate', fmtMoney(s.customerRateAmount, s.currency)],
  ];
  if (s.estimatedDeliveryAt !== undefined) tiles.splice(2, 0, ['Estimated delivery', fmtDateTime(s.estimatedDeliveryAt)]);
  const crew = s.driver || s.vehicle || s.carrierName;

  return (
    <div className="space-y-4">
      {back}
      <Panel title={`Shipment ${s.shipmentNo ?? ''}`} subtitle={`Raised ${fmtDateTime(s.submittedAt)}`} icon={PackageOpen} accent="blue"
        actions={<span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${shipmentStatusTone(s.status)}`}>{shipmentStatusLabel(s.status)}</span>}>
        <div className="space-y-5 text-xs">
          <p className="inline-flex items-center gap-1.5 text-[var(--text-muted)]"><Eye className="w-3.5 h-3.5" /> {TRACKING_LABEL[s.trackingLevel]}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[['From', place(s.origin)], ['To', place(s.destination)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-1"><MapPin className="w-3 h-3" /> {k}</p>
                <p className="text-sm font-bold break-words">{v}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {tiles.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{k}</p>
                <p className="text-xs font-bold break-words">{v}</p>
              </div>
            ))}
          </div>
          {s.cargoSummary && <p><span className="font-semibold">Cargo:</span> {s.cargoSummary}</p>}

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Status timeline</p>
              {s.timeline?.length ? (
                <ol className="space-y-2 border-l border-[var(--border-subtle)] pl-3">
                  {[...s.timeline].reverse().map((t, i) => (
                    <li key={i}>
                      <p className="font-semibold">{shipmentStatusLabel(t.status)}</p>
                      <p className="text-[var(--text-muted)]">{fmtDateTime(t.date)}{t.note ? ` · ${t.note}` : ''}</p>
                    </li>
                  ))}
                </ol>
              ) : <p className="text-[var(--text-muted)]">No updates yet.</p>}
            </div>
            {crew ? (
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)] p-3 self-start space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5"><UserRound className="w-3.5 h-3.5" /> Carrier, driver and vehicle</p>
                {s.carrierName && <p className="font-semibold">{s.carrierName}</p>}
                {s.driver?.name && <p className="text-sm font-bold">{s.driver.name}</p>}
                {s.driver?.phone && <a href={`tel:${s.driver.phone}`} className="flex items-center gap-1.5 text-blue-500"><Phone className="w-3.5 h-3.5" /> {s.driver.phone}</a>}
                {s.vehicle && <p className="flex items-center gap-1.5"><Car className="w-3.5 h-3.5" /> {[s.vehicle.plate, s.vehicle.type].filter(Boolean).join(' · ')}</p>}
                {s.liveLocation && (
                  <a href={`https://www.google.com/maps?q=${s.liveLocation.lat},${s.liveLocation.lng}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-1.5 text-blue-500"><Navigation className="w-3.5 h-3.5" /> Last position {fmtDateTime(s.liveLocation.capturedAt)}</a>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}

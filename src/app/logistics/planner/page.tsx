'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import RouteOptimizerPanel from '@/components/route-optimizer/RouteOptimizerPanel';

interface RouteResult {
  summary: { stops: number; distanceKm: number; durationHuman: string; fuelCostAED: number };
}
interface Waypoint {
  id: string; label: string; lng: number; lat: number;
  type: 'origin' | 'stop' | 'destination';
}

export default function LogisticsPlannerPage() {
  const router  = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState<string | null>(null);
  const [error,  setError]  = useState<string | null>(null);

  const handleSave = async (route: RouteResult, waypoints: Waypoint[]) => {
    setSaving(true);
    setError(null);
    try {
      const origin      = waypoints.find(w => w.type === 'origin');
      const destination = waypoints.find(w => w.type === 'destination');
      const stops       = waypoints.filter(w => w.type === 'stop');
      const ref         = `LOG-${Date.now().toString(36).toUpperCase()}`;

      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingRef:    ref,
          serviceType:   'LOGISTICS',
          requestorName: 'Route Planner',
          startDate:     new Date().toISOString(),
          status:        'PENDING',
          notes: JSON.stringify({
            origin:        origin?.label ?? '',
            destination:   destination?.label ?? '',
            stops:         stops.map(s => s.label),
            distanceKm:    route.summary.distanceKm,
            durationHuman: route.summary.durationHuman,
            fuelCostAED:   route.summary.fuelCostAED,
          }),
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSaved(data.bookingRef ?? ref);
      // Give user a moment to see the success state, then redirect
      setTimeout(() => router.push('/logistics/dispatch'), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save route');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Route Optimization</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Plan and optimize multi-drop delivery routes — powered by Mapbox + Google Maps
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full">
          🗺️ Hybrid Routing
        </div>
      </div>

      {/* Save status banners */}
      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-emerald-400 text-lg">✅</span>
          <div>
            <p className="text-emerald-300 text-sm font-semibold">Route saved as booking <span className="font-mono">{saved}</span></p>
            <p className="text-emerald-400/70 text-xs">Redirecting to Dispatch Board…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <RouteOptimizerPanel
        mode="logistics"
        vehicleType="truck"
        onSave={handleSave}
      />
    </div>
  );
}

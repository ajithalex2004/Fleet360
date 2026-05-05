'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import RouteOptimizerPanel from '@/components/route-optimizer/RouteOptimizerPanel';

interface RouteResult {
  summary: { stops: number; distanceKm: number; durationMin: number; durationHuman: string; fuelCostAED: number };
}
interface Waypoint {
  id: string; label: string; lng: number; lat: number;
  type: 'origin' | 'stop' | 'destination';
}

export default function StaffRoutePlannerPage() {
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

      const routeName = origin && destination
        ? `${origin.label.slice(0, 30)} → ${destination.label.slice(0, 30)}`
        : `Staff Route ${new Date().toLocaleDateString('en-AE')}`;

      const res = await fetch('/api/bus-ops/routes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                 routeName,
          origin:               origin?.label ?? '',
          destination:          destination?.label ?? '',
          routeType:            'STAFF',
          totalDistanceKm:      route.summary.distanceKm,
          estimatedDurationMins: Math.round(route.summary.durationMin),
          isActive:             false, // Requires review before activation
          notes: `Optimised route — ${route.summary.distanceKm} km · ${route.summary.durationHuman} · AED ${route.summary.fuelCostAED} fuel est.`,
          stops: [
            // First stop = origin
            ...(origin ? [{
              stopName: origin.label, sequence: 1,
              gpsLng: origin.lng, gpsLat: origin.lat,
            }] : []),
            // Intermediate stops
            ...stops.map((s, i) => ({
              stopName: s.label, sequence: i + 2,
              gpsLng: s.lng, gpsLat: s.lat,
            })),
            // Last stop = destination
            ...(destination ? [{
              stopName: destination.label, sequence: stops.length + 2,
              gpsLng: destination.lng, gpsLat: destination.lat,
            }] : []),
          ],
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSaved(data.id ?? 'saved');
      setTimeout(() => router.push('/bus-ops/routes'), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save route');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff Route Planner</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Optimise staff pickup routes to reduce travel time and fuel consumption
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-purple-400 bg-purple-500/10 border border-purple-500/20 px-3 py-1.5 rounded-full">
          🗺️ Hybrid Routing
        </div>
      </div>

      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-emerald-400 text-lg">✅</span>
          <div>
            <p className="text-emerald-300 text-sm font-semibold">Staff route saved successfully</p>
            <p className="text-emerald-400/70 text-xs">Route awaits review before activation · Redirecting to Routes…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <RouteOptimizerPanel
        mode="staff"
        vehicleType="bus"
        onSave={handleSave}
      />
    </div>
  );
}

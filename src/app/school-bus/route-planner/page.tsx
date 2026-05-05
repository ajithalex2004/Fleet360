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

export default function SchoolBusRoutePlannerPage() {
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

      const routeName = destination
        ? `School Route → ${destination.label.slice(0, 40)}`
        : `School Bus Route ${new Date().toLocaleDateString('en-AE')}`;

      const res = await fetch('/api/bus-ops/routes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:                  routeName,
          origin:                origin?.label ?? '',
          destination:           destination?.label ?? '',
          routeType:             'SCHOOL',
          totalDistanceKm:       route.summary.distanceKm,
          estimatedDurationMins: Math.round(route.summary.durationMin),
          isActive:              false, // Requires safety review before activation
          notes: `School bus route — ${stops.length} student stops · ${route.summary.distanceKm} km · ${route.summary.durationHuman} · AED ${route.summary.fuelCostAED} fuel est. Pending safety review.`,
          stops: [
            ...(origin ? [{
              stopName: origin.label, sequence: 1,
              gpsLng: origin.lng, gpsLat: origin.lat,
            }] : []),
            ...stops.map((s, i) => ({
              stopName: s.label, sequence: i + 2,
              gpsLng: s.lng, gpsLat: s.lat,
            })),
            ...(destination ? [{
              stopName: destination.label, sequence: stops.length + 2,
              gpsLng: destination.lng, gpsLat: destination.lat,
            }] : []),
          ],
        }),
      });

      if (!res.ok) throw new Error(await res.text());
      setSaved(routeName);
      setTimeout(() => router.push('/school-bus/routes'), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save route');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">School Bus Route Planner</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            Build optimised student pickup routes with safety-first stop sequencing
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 px-3 py-1.5 rounded-full">
          🏫 Student Safety Mode
        </div>
      </div>

      {/* Safety reminder */}
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
        <span className="text-xl">⚠️</span>
        <p className="text-yellow-300 text-xs leading-relaxed">
          All school bus routes require a safety review before activation. Optimised stops are suggestions only —
          verify each stop is safe for student boarding and alighting.
        </p>
      </div>

      {saved && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-emerald-400 text-lg">✅</span>
          <div>
            <p className="text-emerald-300 text-sm font-semibold">Route saved — pending safety review</p>
            <p className="text-emerald-400/70 text-xs">A school safety officer must activate this route · Redirecting to Routes…</p>
          </div>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <RouteOptimizerPanel
        mode="school"
        vehicleType="bus"
        onSave={handleSave}
      />
    </div>
  );
}

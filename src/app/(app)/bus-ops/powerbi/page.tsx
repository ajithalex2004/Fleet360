'use client';
/**
 * /bus-ops/powerbi — Power BI connector.
 *
 * Documents the Fleet360 → Power BI integration. Power BI's "Get Data
 * → Web" connector can pull JSON from any URL, so we expose a small
 * set of clean REST endpoints under /api/powerbi/[endpoint] and document
 * the schema here.
 *
 * The page also lets the user copy their xl-session cookie into a
 * one-time credential dialog (Power BI's Web connector supports
 * custom headers including Cookie / Authorization).
 */
import React, { useState } from 'react';
import { BarChart3, Copy, CheckCircle2, ExternalLink, Code2, Database, FileJson } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface Endpoint {
  id: string;
  label: string;
  description: string;
  fields: Array<{ name: string; type: string; note?: string }>;
  exampleRow: Record<string, unknown>;
}

const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://app.fleet360.example';

const ENDPOINTS: Endpoint[] = [
  {
    id: 'schedule',
    label: 'Trip Schedule',
    description: 'Flattened trip_schedules joined with route + last trip_log. One row per trip — the core fact table for time-of-day analysis.',
    fields: [
      { name: 'tripId', type: 'string' }, { name: 'tripNumber', type: 'string' },
      { name: 'routeId', type: 'string' }, { name: 'routeName', type: 'string' },
      { name: 'routeType', type: 'string', note: 'STAFF | SCHOOL | BOTH' },
      { name: 'origin', type: 'string' }, { name: 'destination', type: 'string' },
      { name: 'scheduledDeparture', type: 'ISO timestamp' }, { name: 'scheduledArrival', type: 'ISO timestamp' },
      { name: 'actualDeparture', type: 'ISO timestamp | null' }, { name: 'actualArrival', type: 'ISO timestamp | null' },
      { name: 'direction', type: 'string' }, { name: 'shiftType', type: 'string' },
      { name: 'capacity', type: 'integer' }, { name: 'confirmedCount', type: 'integer' },
      { name: 'passengersBoarded', type: 'integer | null' }, { name: 'passengersAlighted', type: 'integer | null' },
      { name: 'status', type: 'string' }, { name: 'schedulingMode', type: 'TIMEPOINT | HEADWAY' },
      { name: 'vehicleId', type: 'string | null' }, { name: 'driverId', type: 'string | null' },
    ],
    exampleRow: { tripId: 't_abc123', tripNumber: 'TRP-00042', routeId: 'r1', routeName: 'Route 1 — Marina ↔ DIFC', routeType: 'STAFF', origin: 'Dubai Marina', destination: 'DIFC', scheduledDeparture: '2026-08-10T06:00:00Z', scheduledArrival: '2026-08-10T07:15:00Z', direction: 'INBOUND', shiftType: 'MORNING', capacity: 30, confirmedCount: 24, status: 'COMPLETED', schedulingMode: 'TIMEPOINT' },
  },
  {
    id: 'stops',
    label: 'Route Stops',
    description: 'All bus stops across the tenant, with their sequence within the route. Join to schedule on routeId for stop-level ETA analytics.',
    fields: [
      { name: 'stopId', type: 'string' }, { name: 'routeId', type: 'string' },
      { name: 'routeName', type: 'string' }, { name: 'stopName', type: 'string' },
      { name: 'sequence', type: 'integer' }, { name: 'estimatedArrivalMins', type: 'integer | null' },
      { name: 'landmark', type: 'string | null' }, { name: 'gpsLat', type: 'number | null' },
      { name: 'gpsLng', type: 'number | null' },
    ],
    exampleRow: { stopId: 's1', routeId: 'r1', routeName: 'Route 1 — Marina ↔ DIFC', stopName: 'Dubai Marina Tram', sequence: 1, estimatedArrivalMins: 0, gpsLat: 25.0805, gpsLng: 55.1407 },
  },
  {
    id: 'drivers',
    label: 'Drivers + Trip Counts',
    description: 'Driver roster with a per-driver trip count for the requested date range. Use for utilisation, on-time, and OT analysis.',
    fields: [
      { name: 'driverId', type: 'string' }, { name: 'name', type: 'string' },
      { name: 'firstName', type: 'string' }, { name: 'lastName', type: 'string' },
      { name: 'licenseType', type: 'LIGHT | HEAVY | BUS | MOTORCYCLE' },
      { name: 'status', type: 'ACTIVE | INACTIVE | SUSPENDED' }, { name: 'driverType', type: 'PERMANENT | CONTRACT | OUTSOURCED' },
      { name: 'tripCount', type: 'integer', note: 'trips in the requested range' },
    ],
    exampleRow: { driverId: 'd_xyz', name: 'Ahmed Al Marzooqi', firstName: 'Ahmed', lastName: 'Al Marzooqi', licenseType: 'BUS', status: 'ACTIVE', driverType: 'PERMANENT', tripCount: 42 },
  },
  {
    id: 'runs',
    label: 'Planning Runs (per plan)',
    description: 'Driver pieces-of-work from the Planning Core. One row per run across all saved plans. Joins to schedule on tripId for full traceability.',
    fields: [
      { name: 'planId', type: 'string' }, { name: 'planName', type: 'string' },
      { name: 'runDate', type: 'YYYY-MM-DD' }, { name: 'shiftType', type: 'string' },
      { name: 'workMins', type: 'integer' }, { name: 'spreadMins', type: 'integer' },
      { name: 'straightTimeMins', type: 'integer' }, { name: 'overtimeMins', type: 'integer' },
      { name: 'payMins', type: 'integer' }, { name: 'payCost', type: 'number (AED)' },
      { name: 'tripCount', type: 'integer' }, { name: 'planCreatedAt', type: 'ISO timestamp' },
      { name: 'planAppliedAt', type: 'ISO timestamp | null' },
    ],
    exampleRow: { planId: 'plan_abc', planName: 'Plan 2026-08-10 → 2026-08-16', runDate: '2026-08-10', shiftType: 'MORNING', workMins: 480, spreadMins: 600, straightTimeMins: 480, overtimeMins: 0, payMins: 480, payCost: 200, tripCount: 6, planCreatedAt: '2026-08-09T...', planAppliedAt: '2026-08-09T...' },
  },
  {
    id: 'blocks',
    label: 'Planning Blocks (per plan)',
    description: 'Vehicle groupings (one block = one vehicle\'s day). Joins to schedule on tripId for deadhead / vehicle utilisation reports.',
    fields: [
      { name: 'planId', type: 'string' }, { name: 'planName', type: 'string' },
      { name: 'blockDate', type: 'YYYY-MM-DD' }, { name: 'vehicleLabel', type: 'string' },
      { name: 'workMins', type: 'integer' }, { name: 'spanMins', type: 'integer' },
      { name: 'deadheadMins', type: 'integer' }, { name: 'tripCount', type: 'integer' },
    ],
    exampleRow: { planId: 'plan_abc', planName: 'Plan 2026-08-10 → 2026-08-16', blockDate: '2026-08-10', vehicleLabel: 'Block A', workMins: 420, spanMins: 540, deadheadMins: 30, tripCount: 5 },
  },
  {
    id: 'incidents',
    label: 'Incidents',
    description: 'Trip-level incident log. Joins to schedule on tripId for incident-rate dashboards.',
    fields: [
      { name: 'incidentId', type: 'string' }, { name: 'incidentNo', type: 'string' },
      { name: 'incidentType', type: 'string' }, { name: 'severity', type: 'string' },
      { name: 'status', type: 'string' }, { name: 'description', type: 'string' },
      { name: 'location', type: 'string' }, { name: 'vehicleId', type: 'string' },
      { name: 'driverId', type: 'string' }, { name: 'tripId', type: 'string' },
      { name: 'incidentDate', type: 'ISO timestamp' }, { name: 'resolution', type: 'string | null' },
    ],
    exampleRow: { incidentId: 'inc_abc', incidentNo: 'INC-20260810-0001', incidentType: 'BREAKDOWN', severity: 'HIGH', status: 'RESOLVED', description: 'Engine failure on highway', location: 'Sheikh Zayed Road', vehicleId: 'v_abc', driverId: 'd_xyz', tripId: 't_abc', incidentDate: '2026-08-10T07:30:00Z', resolution: 'Replaced alternator' },
  },
];

export default function PowerBiPage() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Power BI Connector"
        subtitle="Stream Fleet360 data into Power BI for custom dashboards. Six tenant-scoped REST endpoints, ready for the Web / OData connector."
        icon={BarChart3}
        accent="cyan"
        actions={
          <a href="https://powerbi.microsoft.com/" target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-800/60 hover:bg-slate-700 px-4 py-2.5 text-sm text-slate-200">
            <ExternalLink className="w-3.5 h-3.5" /> Open Power BI
          </a>
        }
      />

      {/* Setup steps */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
        <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" /> Setup (3 steps)
        </h3>
        <ol className="text-sm text-slate-200 space-y-2 list-decimal list-inside">
          <li>In Power BI Desktop, choose <strong>Get Data → Web</strong>.</li>
          <li>
            Paste an endpoint URL (see table below). The connector <strong>must</strong> send
            the <code className="text-xs bg-slate-900 px-1 py-0.5 rounded">Cookie: xl-session=…</code> header —
            requests without a valid session are rejected with 401 by the tenant middleware.
            Anonymous access is not supported; use a service-account session for automation.
          </li>
          <li>Power BI flattens the <code className="text-xs bg-slate-900 px-1 py-0.5 rounded">value</code> array into a table automatically. Filter by <code className="text-xs bg-slate-900 px-1 py-0.5 rounded">?from=…&to=…</code> to scope the time window.</li>
        </ol>
      </div>

      {/* Endpoints table */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
        <h3 className="text-base font-bold text-white mb-3">Endpoints</h3>
        <div className="space-y-4">
          {ENDPOINTS.map((ep) => (
            <div key={ep.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileJson className="w-3.5 h-3.5 text-cyan-400" /> {ep.label}
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">{ep.description}</p>
                </div>
                <button onClick={() => copy(`${BASE}/api/powerbi/${ep.id}`, `url-${ep.id}`)}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-white px-2 py-1 rounded border border-white/10">
                  {copied === `url-${ep.id}` ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  Copy URL
                </button>
              </div>
              <code className="block text-[11px] font-mono text-cyan-300 bg-slate-950 border border-white/5 rounded px-3 py-1.5 mb-3 break-all">
                GET {BASE}/api/powerbi/{ep.id}?from=2026-08-01&to=2026-08-31
              </code>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-slate-300 font-semibold mb-1">Schema ({ep.fields.length} fields)</summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="text-slate-400 border-b border-white/10">
                        <th className="text-left py-1 px-2">Field</th>
                        <th className="text-left py-1 px-2">Type</th>
                        <th className="text-left py-1 px-2">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ep.fields.map((f) => (
                        <tr key={f.name} className="border-b border-white/5">
                          <td className="py-1 px-2 text-cyan-300 font-mono">{f.name}</td>
                          <td className="py-1 px-2 text-slate-300 font-mono">{f.type}</td>
                          <td className="py-1 px-2 text-slate-500 italic">{f.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-300 font-semibold">Example row</summary>
                  <pre className="text-[10px] font-mono text-slate-300 bg-slate-950 border border-white/5 rounded p-2 mt-1 overflow-x-auto">
{JSON.stringify(ep.exampleRow, null, 2)}
                  </pre>
                </details>
              </details>
            </div>
          ))}
        </div>
      </div>

      {/* Authentication */}
      <div className="rounded-2xl bg-slate-800/50 border border-white/10 p-5">
        <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
          <Code2 className="w-4 h-4 text-cyan-400" /> Authentication
        </h3>
        <p className="text-sm text-slate-200 mb-3">
          All endpoints read the <code className="text-xs bg-slate-900 px-1 py-0.5 rounded">xl-session</code> cookie set by the Fleet360 login. Power BI's Web connector supports custom headers — set:
        </p>
        <pre className="text-xs font-mono text-cyan-300 bg-slate-950 border border-white/5 rounded px-3 py-2 mb-3">
{`Cookie: xl-session=<your-session-cookie-value>`}
        </pre>
        <p className="text-xs text-slate-400">
          For production deployments, ask the Fleet360 team to provision a <em>Power BI service account</em> with an
          API key, so the connector doesn't depend on a browser session. (See TENANT_ISOLATION_STANDARD.md for the
          wider auth model.)
        </p>
      </div>
    </div>
  );
}

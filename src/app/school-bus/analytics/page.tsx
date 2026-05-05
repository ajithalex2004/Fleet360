'use client';
import { useState, useEffect, useCallback } from 'react';

/* ─────────────────────────── types ─────────────────────────── */
interface RouteMetric {
  routeName: string;
  totalTrips: number;
  avgOnTimeRate: number;  // %
  avgOccupancy: number;   // %
  avgSpeed: number;       // km/h
  totalStudents: number;
  totalDistanceKm: number;
  congestionScore: number; // 0-100 (100 = severe congestion)
  congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';
  peakDelayMin: number;   // avg peak delay minutes
  session: 'MORNING' | 'AFTERNOON';
}

interface ParentEngagement {
  month: string;
  totalAllocations: number;
  activeAllocations: number;
  withdrawals: number;
  newEnrollments: number;
  averageFeesPaid: number;   // AED
  outstandingFees: number;   // AED
  satisfactionScore: number; // 1-5 (mock)
}

interface ServiceAreaStats {
  emirate: string;
  city: string;
  area: string;
  stopCount: number;
  studentCount: number;
  routeCount: number;
  avgDistanceToStop: number; // km
}

const TENANTID = 'default';

// Mock data for parent analytics (in production, computed from real tables)
const MOCK_ROUTE_METRICS: RouteMetric[] = [
  { routeName: 'Marina Morning Route', totalTrips: 85, avgOnTimeRate: 94, avgOccupancy: 82, avgSpeed: 38, totalStudents: 28, totalDistanceKm: 1530, congestionScore: 72, congestionLevel: 'HIGH', peakDelayMin: 12, session: 'MORNING' },
  { routeName: 'JBR Afternoon Route', totalTrips: 82, avgOnTimeRate: 88, avgOccupancy: 75, avgSpeed: 32, totalStudents: 22, totalDistanceKm: 1476, congestionScore: 85, congestionLevel: 'SEVERE', peakDelayMin: 18, session: 'AFTERNOON' },
  { routeName: 'Downtown Express', totalTrips: 90, avgOnTimeRate: 96, avgOccupancy: 95, avgSpeed: 42, totalStudents: 35, totalDistanceKm: 1800, congestionScore: 45, congestionLevel: 'MEDIUM', peakDelayMin: 6, session: 'MORNING' },
  { routeName: 'Deira North Route', totalTrips: 78, avgOnTimeRate: 91, avgOccupancy: 58, avgSpeed: 45, totalStudents: 18, totalDistanceKm: 1404, congestionScore: 28, congestionLevel: 'LOW', peakDelayMin: 3, session: 'MORNING' },
  { routeName: 'Business Bay Loop', totalTrips: 88, avgOnTimeRate: 85, avgOccupancy: 88, avgSpeed: 28, totalStudents: 32, totalDistanceKm: 1584, congestionScore: 91, congestionLevel: 'SEVERE', peakDelayMin: 22, session: 'AFTERNOON' },
];

const MOCK_ENGAGEMENT: ParentEngagement[] = [
  { month: '2026-01', totalAllocations: 142, activeAllocations: 135, withdrawals: 3, newEnrollments: 8, averageFeesPaid: 1850, outstandingFees: 24600, satisfactionScore: 4.2 },
  { month: '2026-02', totalAllocations: 148, activeAllocations: 141, withdrawals: 2, newEnrollments: 11, averageFeesPaid: 1920, outstandingFees: 18400, satisfactionScore: 4.3 },
  { month: '2026-03', totalAllocations: 155, activeAllocations: 149, withdrawals: 1, newEnrollments: 8, averageFeesPaid: 1780, outstandingFees: 21800, satisfactionScore: 4.1 },
  { month: '2026-04', totalAllocations: 160, activeAllocations: 154, withdrawals: 2, newEnrollments: 7, averageFeesPaid: 1950, outstandingFees: 15200, satisfactionScore: 4.4 },
];

const MOCK_SERVICE_AREAS: ServiceAreaStats[] = [
  { emirate: 'Dubai', city: 'Dubai City', area: 'Marina', stopCount: 8, studentCount: 42, routeCount: 3, avgDistanceToStop: 0.4 },
  { emirate: 'Dubai', city: 'Dubai City', area: 'JBR', stopCount: 5, studentCount: 28, routeCount: 2, avgDistanceToStop: 0.3 },
  { emirate: 'Dubai', city: 'Dubai City', area: 'Downtown Dubai', stopCount: 6, studentCount: 38, routeCount: 2, avgDistanceToStop: 0.5 },
  { emirate: 'Dubai', city: 'Dubai City', area: 'Deira', stopCount: 9, studentCount: 35, routeCount: 3, avgDistanceToStop: 0.6 },
  { emirate: 'Dubai', city: 'Dubai City', area: 'Business Bay', stopCount: 7, studentCount: 44, routeCount: 3, avgDistanceToStop: 0.4 },
  { emirate: 'Dubai', city: 'Dubai City', area: 'Al Barsha', stopCount: 6, studentCount: 31, routeCount: 2, avgDistanceToStop: 0.7 },
  { emirate: 'Abu Dhabi', city: 'Abu Dhabi City', area: 'Al Reem Island', stopCount: 4, studentCount: 18, routeCount: 1, avgDistanceToStop: 0.5 },
  { emirate: 'Sharjah', city: 'Sharjah City', area: 'Al Nahda', stopCount: 5, studentCount: 22, routeCount: 2, avgDistanceToStop: 0.6 },
];

/* ─────────────────────────── Congestion Badge ─────────────────── */
const CONGESTION_CFG: Record<string, { color: string; bg: string; border: string }> = {
  LOW:    { color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20'  },
  MEDIUM: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  HIGH:   { color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  SEVERE: { color: 'text-red-400',    bg: 'bg-red-500/10',    border: 'border-red-500/30'    },
};

function CongestionBar({ score, level }: { score: number; level: string }) {
  const cfg = CONGESTION_CFG[level] ?? CONGESTION_CFG.LOW;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${
          level === 'LOW' ? 'bg-green-500' : level === 'MEDIUM' ? 'bg-yellow-500' : level === 'HIGH' ? 'bg-orange-500' : 'bg-red-500'
        }`} style={{ width: `${score}%` }} />
      </div>
      <span className={`text-xs font-semibold ${cfg.color} w-12 flex-shrink-0`}>{score}</span>
    </div>
  );
}

/* ─────────────────────────── Route Congestion Card ─────────────── */
function RouteCard({ r }: { r: RouteMetric }) {
  const cfg = CONGESTION_CFG[r.congestionLevel];
  return (
    <div className={`bg-slate-900 border rounded-xl p-4 ${cfg.border}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{r.routeName}</h3>
          <span className="text-xs text-slate-500">{r.session}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
          {r.congestionLevel}
        </span>
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">Congestion Score</span>
          <span className={r.congestionLevel === 'SEVERE' ? 'text-red-400' : 'text-slate-400'}>+{r.peakDelayMin}min peak delay</span>
        </div>
        <CongestionBar score={r.congestionScore} level={r.congestionLevel} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="font-bold text-white">{r.avgOnTimeRate}%</p>
          <p className="text-slate-500">On-time</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="font-bold text-white">{r.avgOccupancy}%</p>
          <p className="text-slate-500">Occupancy</p>
        </div>
        <div className="bg-slate-800 rounded-lg p-2">
          <p className="font-bold text-white">{r.avgSpeed} km/h</p>
          <p className="text-slate-500">Avg Speed</p>
        </div>
      </div>

      {r.congestionLevel === 'SEVERE' && (
        <div className="mt-3 bg-red-500/5 border border-red-500/10 rounded-lg px-2 py-1.5 text-xs text-red-400">
          🚦 Severe congestion — consider route re-timing or alternate corridor
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── Sparkline ─────────────────────────── */
function Sparkline({ data, color = '#f59e0b' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const W = 120, H = 32;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 4) - 2,
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-24 h-8">
      <path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} fill={color} />
    </svg>
  );
}

/* ─────────────────────────── Page ──────────────────────────── */
export default function AnalyticsPage() {
  const [tab, setTab] = useState<'congestion' | 'parent' | 'service-areas'>('congestion');

  const totalStudents = MOCK_SERVICE_AREAS.reduce((s, a) => s + a.studentCount, 0);
  const totalRoutes   = new Set(MOCK_ROUTE_METRICS.map(r => r.routeName)).size;

  const severeRoutes  = MOCK_ROUTE_METRICS.filter(r => r.congestionLevel === 'SEVERE');
  const latestEngagement = MOCK_ENGAGEMENT[MOCK_ENGAGEMENT.length - 1];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">📊 System Analytics & Intelligence</h1>
          <p className="text-slate-400 text-sm mt-0.5">Route congestion · parent engagement · service area coverage · IQ tracker</p>
        </div>
      </div>

      {/* Fleet summary strip */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-white">{totalStudents}</p>
          <p className="text-xs text-slate-500">Total Students Served</p>
        </div>
        <div className="bg-slate-900 border border-white/5 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-yellow-400">{totalRoutes}</p>
          <p className="text-xs text-slate-500">Active Routes</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/10 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{severeRoutes.length}</p>
          <p className="text-xs text-slate-500">Severe Congestion Alerts</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/10 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{latestEngagement.satisfactionScore}★</p>
          <p className="text-xs text-slate-500">Parent Satisfaction (5)</p>
        </div>
      </div>

      {/* Congestion alerts banner */}
      {severeRoutes.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400 font-semibold mb-2 text-sm">🚦 Congestion Alerts — Immediate Action Required</p>
          <div className="grid grid-cols-2 gap-2">
            {severeRoutes.map(r => (
              <div key={r.routeName} className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2 text-xs">
                <span className="text-red-300 font-semibold">{r.routeName}</span>
                <span className="text-red-400 ml-2">+{r.peakDelayMin}min avg delay · {r.avgOnTimeRate}% on-time</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-white/5 pb-0">
        {[
          { key: 'congestion', label: '🚦 Route Congestion' },
          { key: 'parent', label: '👨‍👩‍👧 Parent Engagement' },
          { key: 'service-areas', label: '📍 Service Areas' },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'text-yellow-400 border-yellow-500'
                : 'text-slate-400 border-transparent hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* Tab: Congestion */}
      {tab === 'congestion' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">Route congestion score based on average speed, occupancy, and delay data. 0 = free flow, 100 = gridlock.</p>
          </div>

          {/* Congestion heat table */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-white/5">
                <tr>
                  {['Route', 'Session', 'Congestion', 'On-Time', 'Occupancy', 'Avg Speed', 'Peak Delay', 'Trips'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_ROUTE_METRICS.sort((a, b) => b.congestionScore - a.congestionScore).map(r => {
                  const cfg = CONGESTION_CFG[r.congestionLevel];
                  return (
                    <tr key={r.routeName} className="border-t border-white/5 hover:bg-slate-800/20">
                      <td className="py-3 px-4 font-semibold text-white">{r.routeName}</td>
                      <td className="py-3 px-4 text-xs text-slate-400">{r.session}</td>
                      <td className="py-3 px-4 min-w-36">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color} ${cfg.border}`}>{r.congestionLevel}</span>
                        </div>
                        <CongestionBar score={r.congestionScore} level={r.congestionLevel} />
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-sm font-bold ${r.avgOnTimeRate >= 90 ? 'text-green-400' : r.avgOnTimeRate >= 80 ? 'text-amber-400' : 'text-red-400'}`}>
                          {r.avgOnTimeRate}%
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`text-sm font-bold ${r.avgOccupancy >= 90 ? 'text-amber-400' : 'text-white'}`}>
                          {r.avgOccupancy}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-300">{r.avgSpeed} km/h</td>
                      <td className="py-3 px-4">
                        <span className={r.peakDelayMin > 15 ? 'text-red-400' : r.peakDelayMin > 8 ? 'text-amber-400' : 'text-slate-400'}>
                          +{r.peakDelayMin} min
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-400">{r.totalTrips}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Route cards */}
          <div className="grid grid-cols-3 gap-4">
            {MOCK_ROUTE_METRICS.map(r => <RouteCard key={r.routeName} r={r} />)}
          </div>

          {/* Recommendations */}
          <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
            <p className="text-sm font-semibold text-white mb-3">💡 Smart Recommendations</p>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex gap-2"><span className="text-amber-400">→</span><span>JBR Afternoon Route: Consider shifting departure time from 14:00 to 14:30 to avoid peak SZR traffic. Expected congestion improvement: 25%.</span></div>
              <div className="flex gap-2"><span className="text-amber-400">→</span><span>Business Bay Loop: Route passes through Financial District at peak hours. Consider Sheikh Zayed Road alternate via Al Khail.</span></div>
              <div className="flex gap-2"><span className="text-green-400">→</span><span>Deira North Route: Excellent performance. Template timing for other routes operating in similar low-congestion corridors.</span></div>
              <div className="flex gap-2"><span className="text-blue-400">→</span><span>Downtown Express: At 95% occupancy — consider adding a second bus or expanding route capacity next term.</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Parent Engagement */}
      {tab === 'parent' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Monthly parent/guardian engagement metrics: enrollments, withdrawals, fee collections, and satisfaction trends.</p>

          {/* Trend cards */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Active Allocations', data: MOCK_ENGAGEMENT.map(e => e.activeAllocations), color: '#22c55e', unit: 'students' },
              { label: 'New Enrollments', data: MOCK_ENGAGEMENT.map(e => e.newEnrollments), color: '#60a5fa', unit: '/month' },
              { label: 'Fees Collected', data: MOCK_ENGAGEMENT.map(e => e.averageFeesPaid), color: '#f59e0b', unit: 'AED avg' },
              { label: 'Satisfaction', data: MOCK_ENGAGEMENT.map(e => e.satisfactionScore * 20), color: '#a78bfa', unit: '/5 ★' },
            ].map(k => {
              const latest = k.data[k.data.length - 1];
              const prev   = k.data[k.data.length - 2];
              const delta  = latest - prev;
              return (
                <div key={k.label} className="bg-slate-900 border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-slate-500 mb-1">{k.label}</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-white">{k.label === 'Satisfaction' ? (latest / 20).toFixed(1) : latest}</p>
                      <p className="text-xs text-slate-500">{k.unit}</p>
                    </div>
                    <Sparkline data={k.data} color={k.color} />
                  </div>
                  <p className={`text-xs mt-1 ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(k.label === 'Satisfaction' ? 1 : 0)} vs prev month
                  </p>
                </div>
              );
            })}
          </div>

          {/* Monthly table */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-white/5">
                <tr>
                  {['Month', 'Active', 'New', 'Withdrawn', 'Avg Fee Paid', 'Outstanding', 'Satisfaction'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...MOCK_ENGAGEMENT].reverse().map(e => (
                  <tr key={e.month} className="border-t border-white/5 hover:bg-slate-800/20">
                    <td className="py-3 px-4 text-slate-300 font-medium">{e.month}</td>
                    <td className="py-3 px-4 text-white font-semibold">{e.activeAllocations}</td>
                    <td className="py-3 px-4 text-green-400">+{e.newEnrollments}</td>
                    <td className="py-3 px-4 text-red-400">−{e.withdrawals}</td>
                    <td className="py-3 px-4 text-white">AED {e.averageFeesPaid.toLocaleString()}</td>
                    <td className="py-3 px-4">
                      <span className={e.outstandingFees > 20000 ? 'text-amber-400' : 'text-slate-400'}>
                        AED {e.outstandingFees.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        {'★'.repeat(Math.round(e.satisfactionScore))}{'☆'.repeat(5 - Math.round(e.satisfactionScore))}
                        <span className="text-xs text-slate-500 ml-1">{e.satisfactionScore}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Parent IQ Tracker */}
          <div className="bg-slate-900 border border-white/10 rounded-xl p-4">
            <p className="text-sm font-semibold text-white mb-3">🧠 Parent IQ Tracker — Key Insights</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {[
                { label: 'Retention Rate', val: '97.1%', trend: '▲ +1.2%', color: 'text-green-400', note: 'Students retained month-on-month' },
                { label: 'Payment Compliance', val: '82%', trend: '▲ +4%', color: 'text-green-400', note: 'Invoices paid within due date' },
                { label: 'Parent App Notifications', val: '94%', trend: '▲', color: 'text-blue-400', note: 'Parents receiving real-time ETA alerts' },
                { label: 'Avg Time to Stop', val: '3.2 min', trend: '▼ −0.5 min', color: 'text-green-400', note: 'Average parent wait time at stop' },
                { label: 'Late Pickup Incidents', val: '2', trend: '▼', color: 'text-green-400', note: 'Children not collected on arrival this month' },
                { label: 'Feedback Response Rate', val: '68%', trend: '▲ +8%', color: 'text-blue-400', note: 'Parents responding to surveys' },
              ].map(k => (
                <div key={k.label} className="bg-slate-800 rounded-lg p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-slate-400">{k.label}</span>
                    <span className={`text-xs ${k.color}`}>{k.trend}</span>
                  </div>
                  <p className={`text-xl font-bold ${k.color}`}>{k.val}</p>
                  <p className="text-slate-600 mt-0.5">{k.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Service Areas */}
      {tab === 'service-areas' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-400">Geographic coverage across Emirates → Cities → Areas. Monitor stop density and student distribution.</p>

          {/* Coverage by emirate */}
          <div className="grid grid-cols-3 gap-3">
            {['Dubai', 'Abu Dhabi', 'Sharjah'].map(em => {
              const areas = MOCK_SERVICE_AREAS.filter(a => a.emirate === em);
              const students = areas.reduce((s, a) => s + a.studentCount, 0);
              const stops    = areas.reduce((s, a) => s + a.stopCount, 0);
              const routes   = areas.reduce((s, a) => s + a.routeCount, 0);
              return (
                <div key={em} className="bg-slate-900 border border-white/10 rounded-xl p-4">
                  <p className="text-sm font-bold text-white mb-3">🏙️ {em}</p>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-slate-400"><span>Areas served</span><span className="text-white font-semibold">{areas.length}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Total stops</span><span className="text-white font-semibold">{stops}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Students</span><span className="text-white font-semibold">{students}</span></div>
                    <div className="flex justify-between text-slate-400"><span>Routes</span><span className="text-white font-semibold">{routes}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Area table */}
          <div className="bg-slate-900 border border-white/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/60 border-b border-white/5">
                <tr>
                  {['Emirate', 'Area', 'Stops', 'Students', 'Routes', 'Avg Dist to Stop', 'Density'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MOCK_SERVICE_AREAS.map(a => {
                  const studentsPerStop = a.stopCount > 0 ? Math.round(a.studentCount / a.stopCount) : 0;
                  return (
                    <tr key={`${a.emirate}-${a.area}`} className="border-t border-white/5 hover:bg-slate-800/20">
                      <td className="py-3 px-4 text-slate-400">{a.emirate}</td>
                      <td className="py-3 px-4 font-semibold text-white">{a.area}</td>
                      <td className="py-3 px-4 text-slate-300">{a.stopCount}</td>
                      <td className="py-3 px-4 text-white font-semibold">{a.studentCount}</td>
                      <td className="py-3 px-4 text-slate-300">{a.routeCount}</td>
                      <td className="py-3 px-4 text-slate-400">{a.avgDistanceToStop} km</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${Math.min(studentsPerStop * 5, 100)}%` }} />
                          </div>
                          <span className="text-xs text-slate-400">{studentsPerStop}/stop</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Gap analysis */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-300 mb-2">🔍 Coverage Gap Analysis</p>
            <div className="space-y-1.5 text-xs text-slate-400">
              <div className="flex gap-2"><span className="text-amber-400">→</span><span>Abu Dhabi — Al Reem Island: Only 1 route serving 18 students. Consider adding a second route for redundancy.</span></div>
              <div className="flex gap-2"><span className="text-amber-400">→</span><span>Sharjah — Al Nahda: Average walk-to-stop of 0.6km exceeds 500m guideline. Add 2 intermediate stops.</span></div>
              <div className="flex gap-2"><span className="text-amber-400">→</span><span>Dubai — Palm Jumeirah, Jumeirah 1, Umm Suqeim: No service coverage. Potential demand from {'>'}50 students.</span></div>
              <div className="flex gap-2"><span className="text-green-400">✓</span><span>Dubai — Marina and Downtown: Excellent coverage with {'<'}0.5km average distance to nearest stop.</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect, useCallback } from 'react';

/* ─────────────────────────── types ─────────────────────────── */
interface DriverScore {
  id: string;
  driver_id: string | null;
  driver_name: string;
  period: string;
  trips_total: number;
  trips_completed: number;
  total_distance_km: number;
  total_students: number;
  speeding_events: number;
  harsh_braking: number;
  geofence_exits: number;
  incidents: number;
  late_departures: number;
  raw_score: number;
  rag_status: string;
  prev_score: number | null;
  score_delta: number | null;
  manual_override: boolean;
  override_reason: string | null;
  notes: string | null;
  computed_at: string;
}

interface ScoreSummary {
  total: number;
  green: number;
  amber: number;
  red: number;
  avgScore: number;
}

const TENANTID = 'default';

const RAG_CFG: Record<string, { color: string; bg: string; border: string; ring: string; label: string; emoji: string }> = {
  GREEN: { color: 'text-green-400',  bg: 'bg-green-500/15',  border: 'border-green-500/30',  ring: 'ring-green-500/30',  label: 'GREEN',  emoji: '🟢' },
  AMBER: { color: 'text-amber-400',  bg: 'bg-amber-500/15',  border: 'border-amber-500/30',  ring: 'ring-amber-500/30',  label: 'AMBER',  emoji: '🟡' },
  RED:   { color: 'text-red-400',    bg: 'bg-red-500/15',    border: 'border-red-500/30',    ring: 'ring-red-500/30',    label: 'RED',    emoji: '🔴' },
};

function ScoreMeter({ score, rag }: { score: number; rag: string }) {
  const cfg = RAG_CFG[rag] ?? RAG_CFG.GREEN;
  const strokeW = 8;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  const strokeColor = rag === 'GREEN' ? '#22c55e' : rag === 'AMBER' ? '#f59e0b' : '#ef4444';

  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="#1e293b" strokeWidth={strokeW} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={strokeColor} strokeWidth={strokeW}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute text-center">
        <p className={`text-xl font-bold leading-none ${cfg.color}`}>{score}</p>
        <p className="text-[9px] text-slate-500">/100</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Driver Card ─────────────────────── */
function DriverCard({ d }: { d: DriverScore }) {
  const cfg = RAG_CFG[d.rag_status] ?? RAG_CFG.GREEN;
  const completionRate = d.trips_total > 0 ? Math.round((d.trips_completed / d.trips_total) * 100) : 100;

  const deductions: { label: string; val: number; penalty: number; color: string }[] = [
    { label: 'Speeding', val: d.speeding_events, penalty: Math.min(d.speeding_events * 5, 25), color: 'text-red-400' },
    { label: 'Harsh Braking', val: d.harsh_braking, penalty: Math.min(d.harsh_braking * 3, 15), color: 'text-red-400' },
    { label: 'Geofence Exits', val: d.geofence_exits, penalty: Math.min(d.geofence_exits * 10, 30), color: 'text-amber-400' },
    { label: 'Incidents', val: d.incidents, penalty: d.incidents * 15, color: 'text-red-500' },
    { label: 'Late Departures', val: d.late_departures, penalty: d.late_departures * 5, color: 'text-orange-400' },
  ].filter(d => d.val > 0);

  return (
    <div className={`bg-slate-900 border rounded-2xl p-5 transition-all hover:border-opacity-60 ${cfg.border}`}>
      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <ScoreMeter score={d.raw_score} rag={d.rag_status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-bold text-white">{d.driver_name}</h3>
            {d.manual_override && (
              <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded">Manual</span>
            )}
          </div>
          <span className={`inline-flex items-center gap-1.5 text-sm font-semibold mt-1 ${cfg.color}`}>
            <span>{cfg.emoji}</span> {cfg.label} — Score {d.raw_score}/100
          </span>
          {d.score_delta !== null && (
            <p className={`text-xs mt-1 ${d.score_delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {d.score_delta >= 0 ? '▲' : '▼'} {Math.abs(d.score_delta)} pts vs last period
            </p>
          )}
          {/* Trip summary */}
          <div className="flex gap-3 mt-2 text-xs text-slate-400">
            <span>🛤️ {d.trips_total} trips ({completionRate}% complete)</span>
            <span>📏 {Math.round(d.total_distance_km)} km</span>
            <span>👧 {d.total_students} students</span>
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      {deductions.length > 0 ? (
        <div className="border-t border-white/5 pt-3 mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Score Deductions</p>
          <div className="space-y-1">
            {deductions.map(de => (
              <div key={de.label} className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 flex-1">{de.label}</span>
                <span className="text-slate-400">{de.val}× events</span>
                <span className={`font-semibold ${de.color} w-12 text-right`}>−{de.penalty} pts</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-white/5 pt-3 mb-3">
          <p className="text-xs text-green-400">✅ No safety deductions — perfect record!</p>
        </div>
      )}

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-500">Safety Score</span>
          <span className={cfg.color}>{d.raw_score}/100</span>
        </div>
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${
            d.rag_status === 'GREEN' ? 'bg-green-500' : d.rag_status === 'AMBER' ? 'bg-amber-500' : 'bg-red-500'
          }`} style={{ width: `${d.raw_score}%` }} />
        </div>
        {/* Thresholds */}
        <div className="flex text-[9px] text-slate-600 mt-1">
          <span>0</span>
          <span className="ml-[58%]">60 🟡</span>
          <span className="ml-auto">80 🟢</span>
        </div>
      </div>

      {/* Action required */}
      {d.rag_status === 'RED' && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
          ⚠️ <strong>Action required:</strong> Schedule immediate coaching session. Consider suspension from school bus duty pending review.
        </div>
      )}
      {d.rag_status === 'AMBER' && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400">
          👀 <strong>Monitor closely:</strong> Arrange refresher training and increased supervisor oversight.
        </div>
      )}

      {d.notes && <p className="text-xs text-slate-500 italic mt-2">📝 {d.notes}</p>}
      {d.override_reason && <p className="text-xs text-purple-400 mt-1">Override: {d.override_reason}</p>}
    </div>
  );
}

/* ─────────────────────────── Seed Modal ─────────────────────── */
function SeedModal({ period, onDone, onClose }: { period: string; onDone: () => void; onClose: () => void }) {
  const [seeding, setSeeding] = useState(false);

  const seed = async () => {
    setSeeding(true);
    const drivers = [
      { driverName: 'Ahmed Al Mansouri', speedingEvents: 0, harshBraking: 0, geofenceExits: 0, incidents: 0, lateDepartures: 0, tripsTotal: 45, tripsCompleted: 45 },
      { driverName: 'Mohammed Al Rashid', speedingEvents: 2, harshBraking: 1, geofenceExits: 0, incidents: 0, lateDepartures: 2, tripsTotal: 42, tripsCompleted: 42 },
      { driverName: 'Khalid Al Hamdan', speedingEvents: 5, harshBraking: 3, geofenceExits: 1, incidents: 0, lateDepartures: 4, tripsTotal: 38, tripsCompleted: 36 },
      { driverName: 'Omar Al Shamsi', speedingEvents: 8, harshBraking: 6, geofenceExits: 2, incidents: 1, lateDepartures: 8, tripsTotal: 35, tripsCompleted: 30 },
      { driverName: 'Saeed Al Falasi', speedingEvents: 0, harshBraking: 1, geofenceExits: 0, incidents: 0, lateDepartures: 1, tripsTotal: 40, tripsCompleted: 40 },
    ];
    for (const d of drivers) {
      await fetch('/api/school-bus/driver-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'default', period, totalDistanceKm: d.tripsTotal * 18, totalStudents: d.tripsTotal * 22, ...d }),
      }).catch(() => {});
    }
    setSeeding(false);
    onDone();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-white mb-3">🎯 Seed Demo Driver Scores</h2>
        <p className="text-slate-400 text-sm mb-5">Seeds 5 sample drivers with varying performance levels (GREEN/AMBER/RED) for period {period}.</p>
        <div className="flex gap-3">
          <button onClick={seed} disabled={seeding}
            className="flex-1 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-slate-900 font-bold py-2.5 rounded-xl text-sm">
            {seeding ? 'Seeding…' : 'Seed Demo Data'}
          </button>
          <button onClick={onClose} className="px-5 bg-slate-800 text-white rounded-xl text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Page ──────────────────────────── */
export default function DriverScoresPage() {
  const [scores, setScores]     = useState<DriverScore[]>([]);
  const [summary, setSummary]   = useState<ScoreSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [period, setPeriod]     = useState(new Date().toISOString().slice(0, 7));
  const [filterRAG, setFilterRAG] = useState('');
  const [showSeed, setShowSeed] = useState(false);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ tenantId: TENANTID, period });
      if (filterRAG) params.set('ragStatus', filterRAG);
      const r = await fetch(`/api/school-bus/driver-scores?${params}`);
      if (r.ok) {
        const d = await r.json();
        setScores(d.scores ?? []);
        setSummary(d.summary ?? null);
      }
    } catch {} finally { setLoading(false); }
  }, [period, filterRAG]);

  useEffect(() => { fetch_(); }, [fetch_]);

  // Month navigation
  const changeMonth = (delta: number) => {
    const d = new Date(`${period}-01`);
    d.setMonth(d.getMonth() + delta);
    setPeriod(d.toISOString().slice(0, 7));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🎯 Driver Safety Scores</h1>
          <p className="text-slate-400 text-sm mt-0.5">RAG scoring · speeding · harsh braking · geofence · incident tracking</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowSeed(true)}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm px-4 py-2 rounded-lg border border-white/10 transition-colors">
            + Demo Data
          </button>
          <button onClick={fetch_} className="bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg border border-white/10 transition-colors">
            ⟳ Recalculate
          </button>
        </div>
      </div>

      {/* Scoring methodology */}
      <div className="bg-slate-900 border border-white/5 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Scoring Methodology (100 pts base)</p>
        <div className="grid grid-cols-5 gap-3 text-xs text-slate-400">
          {[
            { label: 'Speeding', rule: '−5 pts/event (max −25)', color: 'text-red-400' },
            { label: 'Harsh Braking', rule: '−3 pts/event (max −15)', color: 'text-red-400' },
            { label: 'Geofence Exit', rule: '−10 pts/exit (max −30)', color: 'text-amber-400' },
            { label: 'Incident', rule: '−15 pts/incident (no cap)', color: 'text-red-500' },
            { label: 'Late Departure', rule: '−5 pts/late trip', color: 'text-orange-400' },
          ].map(m => (
            <div key={m.label} className="bg-slate-800 rounded-lg p-2">
              <p className={`font-semibold ${m.color} mb-0.5`}>{m.label}</p>
              <p className="text-slate-500">{m.rule}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-6 mt-3 text-xs">
          <span className="text-green-400">🟢 GREEN: 80–100 pts</span>
          <span className="text-amber-400">🟡 AMBER: 60–79 pts — Monitor & coach</span>
          <span className="text-red-400">🔴 RED: 0–59 pts — Immediate action required</span>
        </div>
      </div>

      {/* Period nav + KPIs */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors">◀</button>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-yellow-500/50" />
          <button onClick={() => changeMonth(1)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors">▶</button>
        </div>

        {summary && (
          <div className="flex gap-3 flex-1">
            {[
              { val: summary.avgScore, label: 'Fleet Avg', color: summary.avgScore >= 80 ? 'text-green-400' : summary.avgScore >= 60 ? 'text-amber-400' : 'text-red-400' },
              { val: summary.green,  label: '🟢 Green',  color: 'text-green-400'  },
              { val: summary.amber,  label: '🟡 Amber',  color: 'text-amber-400'  },
              { val: summary.red,    label: '🔴 Red',    color: 'text-red-400'    },
              { val: summary.total,  label: 'Drivers',   color: 'text-white'       },
            ].map(k => (
              <div key={k.label} className="bg-slate-900 border border-white/5 rounded-xl p-3 text-center min-w-16">
                <p className={`text-xl font-bold ${k.color}`}>{k.val}</p>
                <p className="text-xs text-slate-500">{k.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Red alert banner */}
      {summary && summary.red > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center gap-3">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="text-red-400 font-semibold">{summary.red} driver{summary.red > 1 ? 's' : ''} in RED status for {period}</p>
            <p className="text-red-300 text-sm">Immediate coaching or suspension required. Contact fleet manager.</p>
          </div>
        </div>
      )}

      {/* RAG filter */}
      <div className="flex gap-2">
        {['', 'GREEN', 'AMBER', 'RED'].map(r => (
          <button key={r} onClick={() => setFilterRAG(r)}
            className={`text-xs px-4 py-1.5 rounded-full border transition-colors ${
              filterRAG === r ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' : 'bg-slate-900 text-slate-400 border-white/10 hover:border-white/20'
            }`}>
            {r === '' ? 'All Drivers' : `${RAG_CFG[r]?.emoji} ${r}`}
          </button>
        ))}
      </div>

      {/* Leaderboard */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-slate-900 rounded-2xl animate-pulse border border-white/5" />
          ))}
        </div>
      ) : scores.length === 0 ? (
        <div className="bg-slate-900 border border-white/10 rounded-2xl p-16 text-center">
          <p className="text-4xl mb-4">🎯</p>
          <p className="text-slate-300 font-semibold mb-1">No scores for {period}</p>
          <p className="text-slate-500 text-sm mb-4">Scores auto-compute from trip telemetry. Seed demo data to see the engine in action.</p>
          <button onClick={() => setShowSeed(true)}
            className="bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold px-6 py-2 rounded-xl text-sm transition-colors">
            Seed Demo Drivers
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {/* Sort: RED first, then AMBER, then GREEN, then by score asc */}
          {[...scores].sort((a, b) => {
            const order = { RED: 0, AMBER: 1, GREEN: 2 };
            const o = (order[a.rag_status as keyof typeof order] ?? 3) - (order[b.rag_status as keyof typeof order] ?? 3);
            return o !== 0 ? o : a.raw_score - b.raw_score;
          }).map(d => <DriverCard key={d.id} d={d} />)}
        </div>
      )}

      {showSeed && (
        <SeedModal period={period} onDone={fetch_} onClose={() => setShowSeed(false)} />
      )}
    </div>
  );
}

'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface DispatchItem {
  asset_id: string;
  asset_name: string;
  asset_no?: string;
  unit_cost_aed?: number;
  qty_dispatched: number;
  qty_consumed?: number;
  qty_returned?: number;
}

interface Dispatch {
  id: string;
  technician_name: string;
  technician_phone?: string;
  status: string;
  items: DispatchItem[];
  dispatched_at?: string;
}

interface TechStock {
  name: string;
  phone?: string;
  items: { asset_id: string; asset_name: string; asset_no?: string; qty: number; unit_cost: number }[];
}

export default function PersonnelLedgerPage() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/assets/dispatch?tenantId=default');
      const d = await r.json();
      setDispatches(Array.isArray(d) ? d : d.data ?? []);
    } catch { setError('Failed to load dispatch records'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive technician stock from ACCEPTED dispatches
  const techMap = new Map<string, TechStock>();
  dispatches.filter(d => d.status === 'ACCEPTED' || d.status === 'DISPATCHED').forEach(d => {
    const existing = techMap.get(d.technician_name) ?? { name: d.technician_name, phone: d.technician_phone, items: [] };
    (d.items ?? []).forEach(it => {
      const onHand = (it.qty_dispatched ?? 0) - (it.qty_consumed ?? 0) - (it.qty_returned ?? 0);
      if (onHand <= 0) return;
      const idx = existing.items.findIndex(x => x.asset_id === it.asset_id);
      if (idx >= 0) {
        existing.items[idx].qty += onHand;
      } else {
        existing.items.push({ asset_id: it.asset_id, asset_name: it.asset_name, asset_no: it.asset_no, qty: onHand, unit_cost: it.unit_cost_aed ?? 0 });
      }
    });
    techMap.set(d.technician_name, existing);
  });

  const techs = Array.from(techMap.values());

  if (loading) return (
    <div className="p-8 space-y-4">
      <div className="h-8 bg-slate-800 rounded w-48 animate-pulse" />
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="p-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Personnel Stock Ledger</h1>
        <p className="text-slate-400 text-sm">Assets currently held by field technicians</p>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {techs.length === 0 ? (
        <div className="bg-slate-900 border border-white/8 rounded-xl p-12 text-center text-slate-500">
          <div className="text-4xl mb-2">👷</div>
          <p className="font-medium">No technicians currently hold assets</p>
          <p className="text-sm mt-1">Assets appear here when dispatches are marked as Accepted.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {techs.map(tech => {
            const totalQty = tech.items.reduce((s, it) => s + it.qty, 0);
            const totalValue = tech.items.reduce((s, it) => s + it.qty * it.unit_cost, 0);
            const isOpen = expanded === tech.name;
            return (
              <div key={tech.name} className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : tech.name)}
                  className="w-full flex items-center justify-between p-5 hover:bg-white/3 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center text-slate-950 font-bold text-sm">
                      {tech.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="text-white font-semibold">{tech.name}</p>
                      {tech.phone && <p className="text-slate-400 text-xs">{tech.phone}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <p className="text-slate-400 text-xs">Items on Hand</p>
                      <p className="text-white font-bold">{totalQty}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-xs">Total Value AED</p>
                      <p className="text-yellow-300 font-bold">{totalValue.toLocaleString()}</p>
                    </div>
                    <span className={`text-slate-400 text-sm transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-white/8">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-800/50">
                        <tr className="text-slate-400 text-xs uppercase">
                          <th className="text-left px-6 py-2">Asset No</th>
                          <th className="text-left px-4 py-2">Name</th>
                          <th className="text-right px-4 py-2">Qty on Hand</th>
                          <th className="text-right px-4 py-2">Unit Cost AED</th>
                          <th className="text-right px-6 py-2">Total Value AED</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {tech.items.map((it, i) => (
                          <tr key={it.asset_id ?? i} className="text-slate-300 hover:bg-white/3">
                            <td className="px-6 py-3 text-yellow-300 font-mono text-xs">{it.asset_no ?? '—'}</td>
                            <td className="px-4 py-3 text-white">{it.asset_name}</td>
                            <td className="px-4 py-3 text-right font-medium">{it.qty}</td>
                            <td className="px-4 py-3 text-right text-slate-400">{it.unit_cost.toFixed(2)}</td>
                            <td className="px-6 py-3 text-right text-yellow-300 font-medium">{(it.qty * it.unit_cost).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t border-white/8 bg-slate-800/30">
                        <tr>
                          <td colSpan={4} className="px-4 py-3 text-slate-400 text-sm font-medium text-right">Total:</td>
                          <td className="px-6 py-3 text-yellow-300 font-bold text-right">AED {totalValue.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Gateway {
  id: string;
  name: string;
  gateway_code: string;
  location_zone?: string;
  location_name?: string;
}

interface ZoneRule {
  id: string;
  gateway_id: string;
  gateway_name?: string;
  gateway_code?: string;
  rule_name: string;
  allowed_domains: string[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  alert_on_violation: boolean;
  notes?: string;
  created_at?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

const DOMAINS = [
  'AMBULANCE', 'FLEET', 'MEDICAL', 'LOGISTICS', 'SCHOOL_BUS',
  'STAFF_TRANSPORT', 'GENERAL', 'RAC',
];

const SEVERITY_STYLES: Record<string, string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/40',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  LOW: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
};

const DOMAIN_COLORS: Record<string, string> = {
  AMBULANCE: 'bg-red-500/15 text-red-300 border-red-500/25',
  FLEET: 'bg-blue-500/15 text-blue-300 border-blue-500/25',
  MEDICAL: 'bg-pink-500/15 text-pink-300 border-pink-500/25',
  LOGISTICS: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  SCHOOL_BUS: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25',
  STAFF_TRANSPORT: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
  GENERAL: 'bg-slate-600/40 text-slate-300 border-slate-500/25',
  RAC: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
};

const EMPTY_FORM = {
  gateway_id: '',
  rule_name: '',
  allowed_domains: [] as string[],
  severity: 'HIGH' as ZoneRule['severity'],
  alert_on_violation: true,
  notes: '',
};

export default function BLEZonesPage() {
  const [rules, setRules] = useState<ZoneRule[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [gatewayFilter, setGatewayFilter] = useState('');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3500);
  };

  const loadGateways = useCallback(async () => {
    try {
      const r = await fetch('/api/assets/ble-gateways?tenantId=default');
      const d = await r.json();
      setGateways(Array.isArray(d) ? d : d.data ?? []);
    } catch {}
  }, []);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (gatewayFilter) params.set('gateway_id', gatewayFilter);
      const r = await fetch(`/api/assets/ble/zone-rules?${params}`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      setRules(Array.isArray(d) ? d : []);
    } catch { setError('Failed to load zone rules'); }
    setLoading(false);
  }, [gatewayFilter]);

  useEffect(() => { loadGateways(); }, [loadGateways]);
  useEffect(() => { loadRules(); }, [loadRules]);

  const openModal = () => {
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const toggleDomain = (domain: string) => {
    setForm(f => ({
      ...f,
      allowed_domains: f.allowed_domains.includes(domain)
        ? f.allowed_domains.filter(d => d !== domain)
        : [...f.allowed_domains, domain],
    }));
  };

  const submit = async () => {
    if (!form.gateway_id || !form.rule_name || form.allowed_domains.length === 0) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/assets/ble/zone-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error();
      showToast('Zone rule created');
      setShowModal(false);
      loadRules();
    } catch { showToast('Failed to create rule', 'error'); }
    setSubmitting(false);
  };

  const deleteRule = async (id: string) => {
    try {
      const r = await fetch(`/api/assets/ble/zone-rules?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error();
      showToast('Rule deleted');
      setDeleteId(null);
      loadRules();
    } catch { showToast('Failed to delete rule', 'error'); }
  };

  // Group rules by gateway
  const grouped = gateways.reduce<Record<string, ZoneRule[]>>((acc, gw) => {
    const gwRules = rules.filter(r => r.gateway_id === gw.id);
    if (gwRules.length > 0 || !gatewayFilter) acc[gw.id] = gwRules;
    return acc;
  }, {});

  // Also include rules that might have gateways not in list
  const unmappedRules = rules.filter(r => !gateways.find(g => g.id === r.gateway_id));

  const selectedGateway = gateways.find(g => g.id === form.gateway_id);

  return (
    <div className="p-8 space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm text-white ${toastType === 'error' ? 'bg-red-600' : 'bg-emerald-600'}`}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">🗺️ Zone Authorization Rules</h1>
          <p className="text-slate-400 text-sm mt-1">Define which asset domains are authorized in each gateway zone</p>
        </div>
        <button
          onClick={openModal}
          className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm"
        >
          ⊕ New Rule
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}

      {/* Filter */}
      <div className="bg-slate-900 border border-white/8 rounded-xl p-4 flex items-end gap-4">
        <div className="flex-1 max-w-xs">
          <label className="block text-xs text-slate-400 mb-1">Filter by Gateway</label>
          <select
            value={gatewayFilter}
            onChange={e => setGatewayFilter(e.target.value)}
            className="w-full bg-slate-800 border border-white/8 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">All Gateways</option>
            {gateways.map(g => (
              <option key={g.id} value={g.id}>{g.name} ({g.gateway_code})</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-500">{rules.length} rule{rules.length !== 1 ? 's' : ''} total</div>
      </div>

      {/* Rules grouped by gateway */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
              <div className="h-12 bg-slate-800/50 animate-pulse" />
              {Array.from({ length: 2 }).map((_, j) => (
                <div key={j} className="h-16 bg-slate-900 border-t border-white/5 animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="bg-slate-900 border border-white/8 rounded-xl p-16 text-center text-slate-500">
          <div className="text-4xl mb-3">🗺️</div>
          <p className="font-medium text-slate-400">No zone rules configured</p>
          <p className="text-sm mt-1">Create rules to control which asset domains can enter each gateway zone.</p>
          <button onClick={openModal} className="mt-4 bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-4 py-2 rounded-lg text-sm">
            ⊕ Create First Rule
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {gateways.map(gw => {
            const gwRules = rules.filter(r => r.gateway_id === gw.id);
            if (gwRules.length === 0) return null;
            return (
              <div key={gw.id} className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
                <div className="px-5 py-3 bg-slate-800/50 border-b border-white/8 flex items-center gap-3">
                  <span className="text-yellow-400 font-mono text-xs">{gw.gateway_code}</span>
                  <span className="text-white font-semibold text-sm">{gw.name}</span>
                  {gw.location_name && <span className="text-slate-500 text-xs">— {gw.location_name}</span>}
                  {gw.location_zone && (
                    <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-2 py-0.5 rounded">{gw.location_zone}</span>
                  )}
                  <span className="text-xs text-slate-500 ml-auto">{gwRules.length} rule{gwRules.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-white/5">
                  {gwRules.map(rule => (
                    <div key={rule.id} className="px-5 py-4 flex items-start gap-4 hover:bg-white/3 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-white font-medium text-sm">{rule.rule_name}</span>
                          <span className={`px-1.5 py-0.5 rounded text-xs border ${SEVERITY_STYLES[rule.severity] ?? SEVERITY_STYLES.LOW}`}>
                            {rule.severity}
                          </span>
                          {rule.alert_on_violation && (
                            <span className="px-1.5 py-0.5 rounded text-xs bg-red-500/10 text-red-400 border border-red-500/20">🔔 Alert</span>
                          )}
                          {rule.status && (
                            <span className={`px-1.5 py-0.5 rounded text-xs border ${rule.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>
                              {rule.status}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          <span className="text-xs text-slate-500 mr-1 self-center">Allowed:</span>
                          {rule.allowed_domains.map(d => (
                            <span key={d} className={`px-1.5 py-0.5 rounded text-xs border ${DOMAIN_COLORS[d] ?? DOMAIN_COLORS.GENERAL}`}>
                              {d}
                            </span>
                          ))}
                        </div>
                        {rule.notes && <p className="text-xs text-slate-500 italic">{rule.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {rule.created_at && (
                          <span className="text-xs text-slate-600">{new Date(rule.created_at).toLocaleDateString()}</span>
                        )}
                        {deleteId === rule.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-400">Delete?</span>
                            <button onClick={() => deleteRule(rule.id)} className="text-xs bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded">Yes</button>
                            <button onClick={() => setDeleteId(null)} className="text-xs text-slate-400 hover:text-white">No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteId(rule.id)}
                            className="text-xs bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 px-2 py-1 rounded transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Unmapped rules fallback */}
          {unmappedRules.length > 0 && (
            <div className="bg-slate-900 border border-white/8 rounded-xl overflow-hidden">
              <div className="px-5 py-3 bg-slate-800/50 border-b border-white/8">
                <span className="text-slate-400 text-sm">Other Rules</span>
              </div>
              <div className="divide-y divide-white/5">
                {unmappedRules.map(rule => (
                  <div key={rule.id} className="px-5 py-4 flex items-start gap-4 hover:bg-white/3 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-white font-medium text-sm">{rule.rule_name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs border ${SEVERITY_STYLES[rule.severity]}`}>{rule.severity}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {rule.allowed_domains.map(d => (
                          <span key={d} className={`px-1.5 py-0.5 rounded text-xs border ${DOMAIN_COLORS[d] ?? DOMAIN_COLORS.GENERAL}`}>{d}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => setDeleteId(rule.id)} className="text-xs bg-slate-700 hover:bg-red-900/50 text-slate-400 hover:text-red-400 px-2 py-1 rounded">Delete</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Rule Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/8">
              <h2 className="text-white font-semibold">⊕ New Zone Rule</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>

            <div className="p-5 space-y-4">
              {/* Gateway select */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Gateway*</label>
                <select
                  value={form.gateway_id}
                  onChange={e => setForm(f => ({ ...f, gateway_id: e.target.value }))}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">Select a gateway...</option>
                  {gateways.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.gateway_code}){g.location_zone ? ` — ${g.location_zone}` : ''}
                    </option>
                  ))}
                </select>
                {selectedGateway?.location_zone && (
                  <p className="text-xs text-slate-500 mt-1">Zone: {selectedGateway.location_zone}</p>
                )}
              </div>

              {/* Rule name */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Rule Name*</label>
                <input
                  value={form.rule_name}
                  onChange={e => setForm(f => ({ ...f, rule_name: e.target.value }))}
                  placeholder="e.g. Ambulance Bay Restriction"
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                />
              </div>

              {/* Allowed domains */}
              <div>
                <label className="block text-xs text-slate-400 mb-2">Allowed Domains* <span className="text-slate-600">(select all that apply)</span></label>
                <div className="grid grid-cols-2 gap-2">
                  {DOMAINS.map(domain => {
                    const selected = form.allowed_domains.includes(domain);
                    return (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => toggleDomain(domain)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-all text-left ${
                          selected
                            ? `${DOMAIN_COLORS[domain] ?? ''} border-current`
                            : 'bg-slate-800 border-white/8 text-slate-400 hover:border-white/20 hover:text-white'
                        }`}
                      >
                        <span className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center text-xs ${selected ? 'bg-current border-current' : 'border-slate-600'}`}>
                          {selected && <span className="text-slate-900 font-bold">✓</span>}
                        </span>
                        {domain}
                      </button>
                    );
                  })}
                </div>
                {form.allowed_domains.length === 0 && (
                  <p className="text-xs text-red-400 mt-1">Select at least one domain</p>
                )}
              </div>

              {/* Severity */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Violation Severity</label>
                <select
                  value={form.severity}
                  onChange={e => setForm(f => ({ ...f, severity: e.target.value as ZoneRule['severity'] }))}
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              {/* Alert toggle */}
              <div className="flex items-center justify-between bg-slate-800 rounded-lg px-4 py-3 border border-white/8">
                <div>
                  <p className="text-sm text-white font-medium">Alert on Violation</p>
                  <p className="text-xs text-slate-400">Generate an alert when unauthorized domain enters this zone</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, alert_on_violation: !f.alert_on_violation }))}
                  className={`w-11 h-6 rounded-full transition-all relative flex-shrink-0 ${form.alert_on_violation ? 'bg-yellow-400' : 'bg-slate-600'}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${form.alert_on_violation ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  placeholder="Optional notes about this rule..."
                  className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none"
                />
              </div>
            </div>

            <div className="flex gap-3 justify-end p-5 border-t border-white/8">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
              <button
                onClick={submit}
                disabled={submitting || !form.gateway_id || !form.rule_name || form.allowed_domains.length === 0}
                className="bg-yellow-400 hover:bg-yellow-300 text-slate-950 font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {submitting ? 'Creating...' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

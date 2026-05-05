'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Incident {
  id: string; incidentNo?: string; scheduleId?: string; routeId?: string; vehicleId?: string; driverId?: string;
  incidentDate: string; incidentType: string; severity?: string; location?: string; description?: string;
  injuriesReported?: boolean; policeReport?: boolean; policeReportNo?: string;
  actionTaken?: string; status?: string; resolvedAt?: string; resolvedBy?: string; createdAt?: string;
}

const TYPES     = ['ACCIDENT','BREAKDOWN','DELAY','MEDICAL','PASSENGER_COMPLAINT','OTHER'];
const SEVERITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];

const SEV_COLORS: Record<string,string> = {
  LOW:      'bg-slate-500/20 text-slate-400 border-slate-500/30',
  MEDIUM:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
};
const STATUS_COLORS: Record<string,string> = {
  OPEN:          'bg-rose-500/20 text-rose-400 border-rose-500/30',
  INVESTIGATING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESOLVED:      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CLOSED:        'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function IncidentsPage() {
  const [incidents, setIncidents]   = useState<Incident[]>([]);
  const [statusFilter, setStatus]   = useState('All');
  const [sevFilter, setSev]         = useState('All');
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const emptyForm = { scheduleId:'', routeId:'', vehicleId:'', driverId:'', incidentDate:'', incidentType:'BREAKDOWN', severity:'LOW', location:'', description:'', injuriesReported:false, policeReport:false, policeReportNo:'', actionTaken:'' };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (sevFilter    !== 'All') params.set('severity', sevFilter);
      const res = await fetch(`/api/bus-ops/incidents?${params}`);
      const data = await res.json();
      setIncidents(Array.isArray(data) ? data : []);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, [statusFilter, sevFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...formData,
        incidentDate: new Date(formData.incidentDate).toISOString(),
        scheduleId:   formData.scheduleId   || null,
        routeId:      formData.routeId      || null,
        vehicleId:    formData.vehicleId    || null,
        driverId:     formData.driverId     || null,
        policeReportNo: formData.policeReportNo || null,
        actionTaken:  formData.actionTaken  || null,
        status: 'OPEN',
      };
      const res = await fetch('/api/bus-ops/incidents', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setShowModal(false);
      setFormData(emptyForm);
      loadData();
    } catch { setError('Failed to create incident'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/bus-ops/incidents/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status }) });
      loadData();
    } catch { setError('Failed to update'); }
  };

  const openCount = incidents.filter(i=>i.status==='OPEN').length;
  const critCount = incidents.filter(i=>i.severity==='CRITICAL').length;

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading incidents...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Incidents</h1>
          <p className="text-slate-400">{openCount} open · {critCount} critical · {incidents.length} total</p>
        </div>
        <button onClick={()=>setShowModal(true)} className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">+ Log Incident</button>
      </div>

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{label:'Open',v:openCount,c:'text-rose-400'},{label:'Critical',v:critCount,c:'text-red-400'},{label:'Resolved',v:incidents.filter(i=>i.status==='RESOLVED').length,c:'text-emerald-400'},{label:'Total',v:incidents.length,c:'text-white'}].map(({label,v,c})=>(
          <div key={label} className="bg-slate-800/50 border border-white/10 rounded-xl p-4 text-center">
            <div className={`text-2xl font-bold ${c}`}>{v}</div>
            <div className="text-xs text-slate-400 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <select value={statusFilter} onChange={e=>setStatus(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
          {['All','OPEN','INVESTIGATING','RESOLVED','CLOSED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sevFilter} onChange={e=>setSev(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
          <option value="All">All Severities</option>
          {SEVERITIES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {incidents.length === 0 ? (
          <div className="text-center text-slate-400 py-12">No incidents found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Incident No.','Date','Type','Severity','Location','Description','Injuries','Status','Actions'].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.map(inc=>(
                <tr key={inc.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-white">{inc.incidentNo}</td>
                  <td className="px-4 py-3 text-sm text-slate-200">{new Date(inc.incidentDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-white">{inc.incidentType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEV_COLORS[inc.severity ?? 'LOW']}`}>{inc.severity ?? 'LOW'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{inc.location ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-white max-w-xs truncate">{inc.description ?? '-'}</td>
                  <td className="px-4 py-3 text-sm">{inc.injuriesReported ? <span className="text-rose-400">Yes</span> : <span className="text-slate-300">No</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[inc.status ?? 'OPEN']}`}>{inc.status ?? 'OPEN'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select value={inc.status ?? 'OPEN'} onChange={e=>updateStatus(inc.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 border border-white/10 text-white focus:outline-none">
                      <option value="OPEN">OPEN</option>
                      <option value="INVESTIGATING">INVESTIGATING</option>
                      <option value="RESOLVED">RESOLVED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Log Incident</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Incident Date & Time *</label>
                  <input type="datetime-local" value={formData.incidentDate} onChange={e=>setFormData(p=>({...p,incidentDate:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Incident Type *</label>
                  <select value={formData.incidentType} onChange={e=>setFormData(p=>({...p,incidentType:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                    {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Severity</label>
                  <select value={formData.severity} onChange={e=>setFormData(p=>({...p,severity:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                    {SEVERITIES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Location</label>
                  <input type="text" value={formData.location} onChange={e=>setFormData(p=>({...p,location:e.target.value}))} placeholder="e.g., Sheikh Zayed Road near Exit 43"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Vehicle ID</label>
                  <input type="text" value={formData.vehicleId} onChange={e=>setFormData(p=>({...p,vehicleId:e.target.value}))} placeholder="Optional"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Driver ID</label>
                  <input type="text" value={formData.driverId} onChange={e=>setFormData(p=>({...p,driverId:e.target.value}))} placeholder="Optional"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
                  <textarea value={formData.description} onChange={e=>setFormData(p=>({...p,description:e.target.value}))} required rows={3} placeholder="Describe what happened..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Action Taken</label>
                  <textarea value={formData.actionTaken} onChange={e=>setFormData(p=>({...p,actionTaken:e.target.value}))} rows={2} placeholder="Immediate actions taken..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none" />
                </div>
                <div className="flex gap-6 col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={formData.injuriesReported} onChange={e=>setFormData(p=>({...p,injuriesReported:e.target.checked}))} className="accent-rose-500 text-white" />
                    Injuries Reported
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={formData.policeReport} onChange={e=>setFormData(p=>({...p,policeReport:e.target.checked}))} className="accent-amber-500 text-white" />
                    Police Report Filed
                  </label>
                </div>
                {formData.policeReport && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-slate-300 mb-2">Police Report No.</label>
                    <input type="text" value={formData.policeReportNo} onChange={e=>setFormData(p=>({...p,policeReportNo:e.target.value}))} placeholder="Report number"
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none" />
                  </div>
                )}
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Logging...' : 'Log Incident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

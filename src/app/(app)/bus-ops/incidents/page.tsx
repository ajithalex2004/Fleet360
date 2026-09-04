'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

interface Incident {
  id: string; incidentNo?: string; scheduleId?: string; routeId?: string; vehicleId?: string; driverId?: string;
  incidentDate: string; incidentType: string; severity?: string; location?: string; description?: string;
  injuriesReported?: boolean; policeReport?: boolean; policeReportNo?: string;
  actionTaken?: string; status?: string; resolvedAt?: string; resolvedBy?: string; createdAt?: string;
}
interface VehicleOpt { id: string; licensePlate?: string; make?: string; model?: string }
interface DriverOpt  { id: string; name: string; licenseType?: string | null }

const TYPES     = ['ACCIDENT','BREAKDOWN','DELAY','MEDICAL','PASSENGER_COMPLAINT','OTHER'];
const SEVERITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];

const SEV_COLORS: Record<string,string> = {
  LOW:      'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  MEDIUM:   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  HIGH:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
};
const STATUS_COLORS: Record<string,string> = {
  OPEN:          'bg-rose-500/20 text-rose-400 border-rose-500/30',
  INVESTIGATING: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  RESOLVED:      'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  CLOSED:        'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
};

export default function IncidentsPage() {
  const [incidents, setIncidents]   = useState<Incident[]>([]);
  const [vehicles,  setVehicles]    = useState<VehicleOpt[]>([]);
  const [drivers,   setDrivers]     = useState<DriverOpt[]>([]);
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
      const [incRes, vRes, dRes] = await Promise.all([
        fetch(`/api/bus-ops/incidents?${params}`, { cache: 'no-store' }),
        fetch('/api/vehicles',         { cache: 'no-store' }),
        fetch('/api/bus-ops/drivers',  { cache: 'no-store' }),
      ]);
      const incData = await incRes.json();
      setIncidents(Array.isArray(incData) ? incData : []);
      if (vRes.ok) {
        const vData = await vRes.json();
        setVehicles(Array.isArray(vData) ? vData : (vData?.vehicles ?? []));
      }
      if (dRes.ok) {
        const dData = await dRes.json();
        setDrivers(Array.isArray(dData) ? dData : []);
      }
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

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-[var(--text-muted)] animate-pulse">Loading incidents...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Incidents"
        subtitle={`${openCount} open · ${critCount} critical · ${incidents.filter(i=>i.status==='RESOLVED').length} resolved · ${incidents.length} total`}
        icon={AlertTriangle}
        accent="violet"
        actions={
          <button onClick={()=>setShowModal(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> Log Incident
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="flex gap-4 flex-wrap">
        <select value={statusFilter} onChange={e=>setStatus(e.target.value)}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
          {['All','OPEN','INVESTIGATING','RESOLVED','CLOSED'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sevFilter} onChange={e=>setSev(e.target.value)}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
          <option value="All">All Severities</option>
          {SEVERITIES.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {incidents.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">No incidents found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                {['Incident No.','Date','Type','Severity','Location','Description','Injuries','Status','Actions'].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incidents.map(inc=>(
                <tr key={inc.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-[var(--text-main)]">{inc.incidentNo}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">{new Date(inc.incidentDate).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">{inc.incidentType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEV_COLORS[inc.severity ?? 'LOW']}`}>{inc.severity ?? 'LOW'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)]">{inc.location ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-[var(--text-main)] max-w-xs truncate">{inc.description ?? '-'}</td>
                  <td className="px-4 py-3 text-sm">{inc.injuriesReported ? <span className="text-rose-400">Yes</span> : <span className="text-[var(--text-muted)]">No</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[inc.status ?? 'OPEN']}`}>{inc.status ?? 'OPEN'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <select value={inc.status ?? 'OPEN'} onChange={e=>updateStatus(inc.id, e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:outline-none">
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
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-main)]">Log Incident</h2>
              <button onClick={()=>setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Incident Date & Time *</label>
                  <input type="datetime-local" value={formData.incidentDate} onChange={e=>setFormData(p=>({...p,incidentDate:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Incident Type *</label>
                  <select value={formData.incidentType} onChange={e=>setFormData(p=>({...p,incidentType:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    {TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Severity</label>
                  <select value={formData.severity} onChange={e=>setFormData(p=>({...p,severity:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    {SEVERITIES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Location</label>
                  <input type="text" value={formData.location} onChange={e=>setFormData(p=>({...p,location:e.target.value}))} placeholder="e.g., Sheikh Zayed Road near Exit 43"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Vehicle</label>
                  <select value={formData.vehicleId} onChange={e=>setFormData(p=>({...p,vehicleId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    <option value="">— Not linked —</option>
                    {vehicles.map(v => {
                      const label = [v.licensePlate, [v.make, v.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || v.id.slice(0,8);
                      return <option key={v.id} value={v.id}>{label}</option>;
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Driver</label>
                  <select value={formData.driverId} onChange={e=>setFormData(p=>({...p,driverId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-violet-500 focus:outline-none">
                    <option value="">— Not linked —</option>
                    {drivers.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.licenseType ? ` (${d.licenseType})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Description *</label>
                  <textarea value={formData.description} onChange={e=>setFormData(p=>({...p,description:e.target.value}))} required rows={3} placeholder="Describe what happened..."
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Action Taken</label>
                  <textarea value={formData.actionTaken} onChange={e=>setFormData(p=>({...p,actionTaken:e.target.value}))} rows={2} placeholder="Immediate actions taken..."
                    className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                </div>
                <div className="flex gap-6 col-span-2">
                  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <input type="checkbox" checked={formData.injuriesReported} onChange={e=>setFormData(p=>({...p,injuriesReported:e.target.checked}))} className="accent-rose-500 text-[var(--text-main)]" />
                    Injuries Reported
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                    <input type="checkbox" checked={formData.policeReport} onChange={e=>setFormData(p=>({...p,policeReport:e.target.checked}))} className="accent-amber-500 text-[var(--text-main)]" />
                    Police Report Filed
                  </label>
                </div>
                {formData.policeReport && (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Police Report No.</label>
                    <input type="text" value={formData.policeReportNo} onChange={e=>setFormData(p=>({...p,policeReportNo:e.target.value}))} placeholder="Report number"
                      className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-violet-500 focus:outline-none" />
                  </div>
                )}
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
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

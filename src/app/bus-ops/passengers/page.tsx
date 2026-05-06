'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { Users, Plus } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';

interface Passenger {
  id: string; tripId: string; employeeId?: string; employeeName?: string; department?: string;
  boardingStopName?: string; alightingStopName?: string; status?: string; boardedAt?: string; notes?: string;
  trip?: { tripNumber?: string; route?: { name: string } };
}
interface Schedule { id: string; tripNumber?: string; route?: { name: string }; departureTime: string; status?: string; }

const STATUS_COLORS: Record<string,string> = {
  CONFIRMED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  BOARDED:   'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ABSENT:    'bg-rose-500/20 text-rose-400 border-rose-500/30',
  NO_SHOW:   'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function PassengersPage() {
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [schedules, setSchedules]   = useState<Schedule[]>([]);
  const [tripFilter, setTripFilter] = useState('');
  const [statusFilter, setStatus]   = useState('All');
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const emptyForm = { tripId:'', employeeId:'', employeeName:'', department:'', boardingStopName:'', alightingStopName:'', notes:'' };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (tripFilter) params.set('tripId', tripFilter);
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/bus-ops/passengers?${params}`),
        fetch('/api/bus-ops/schedules?status=SCHEDULED'),
      ]);
      const [pData, sData] = await Promise.all([pRes.json(), sRes.json()]);
      setPassengers(Array.isArray(pData) ? pData : []);
      setSchedules(Array.isArray(sData) ? sData : []);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, [tripFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/bus-ops/passengers', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...formData, status: 'CONFIRMED', employeeId: formData.employeeId || null }),
      });
      if (!res.ok) throw new Error();
      setShowModal(false);
      setFormData(emptyForm);
      loadData();
    } catch { setError('Failed to add passenger'); }
    finally { setSaving(false); }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      await fetch(`/api/bus-ops/passengers/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status }) });
      loadData();
    } catch { setError('Failed to update'); }
  };

  const removePassenger = async (id: string) => {
    if (!confirm('Remove this passenger from the trip?')) return;
    try {
      await fetch(`/api/bus-ops/passengers/${id}`, { method:'DELETE' });
      loadData();
    } catch { setError('Failed to remove'); }
  };

  const filtered = passengers.filter(p => statusFilter === 'All' || p.status === statusFilter);
  const counts = { CONFIRMED: passengers.filter(p=>p.status==='CONFIRMED').length, BOARDED: passengers.filter(p=>p.status==='BOARDED').length, ABSENT: passengers.filter(p=>p.status==='ABSENT').length };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Passengers"
        subtitle={`${counts.CONFIRMED} confirmed · ${counts.BOARDED} boarded · ${counts.ABSENT} absent · ${passengers.length} total`}
        icon={Users}
        accent="violet"
        actions={
          <button onClick={()=>setShowModal(true)} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus className="w-4 h-4" /> Add Passenger
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <div className="flex gap-4 flex-wrap">
        <select value={tripFilter} onChange={e=>setTripFilter(e.target.value)}
          className="flex-1 min-w-48 max-w-sm px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
          <option value="">All Trips</option>
          {schedules.map(s=><option key={s.id} value={s.id}>{s.tripNumber ?? s.id.slice(0,8)} — {s.route?.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e=>setStatus(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
          {['All','CONFIRMED','BOARDED','ABSENT','NO_SHOW'].map(s=><option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-slate-400 py-12">No passengers found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {['Trip','Emp ID','Name','Department','Boarding Stop','Alighting Stop','Status','Actions'].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p=>(
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                  <td className="px-4 py-3 text-sm text-white">{p.trip?.tripNumber ?? p.tripId.slice(0,8)}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-200">{p.employeeId ?? '-'}</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{p.employeeName ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-white">{p.department ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-white">{p.boardingStopName ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-white">{p.alightingStopName ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[p.status ?? 'CONFIRMED']}`}>{p.status ?? 'CONFIRMED'}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {p.status === 'CONFIRMED' && (
                        <button onClick={()=>updateStatus(p.id,'BOARDED')} className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30">Board</button>
                      )}
                      {p.status === 'CONFIRMED' && (
                        <button onClick={()=>updateStatus(p.id,'ABSENT')} className="text-xs px-2 py-1 rounded bg-rose-500/20 text-rose-400 border border-rose-500/30 hover:bg-rose-500/30">Absent</button>
                      )}
                      <button onClick={()=>removePassenger(p.id)} className="text-xs px-2 py-1 rounded bg-slate-700 text-slate-200 border border-white/10 hover:bg-slate-600">Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Add Passenger to Trip</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Trip *</label>
                <select value={formData.tripId} onChange={e=>setFormData(p=>({...p,tripId:e.target.value}))} required
                  className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                  <option value="">Select trip</option>
                  {schedules.map(s=><option key={s.id} value={s.id}>{s.tripNumber ?? s.id.slice(0,8)} — {s.route?.name} ({new Date(s.departureTime).toLocaleDateString()})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  {label:'Employee Name *',key:'employeeName',ph:'Ahmed Al-Mansouri',required:true},
                  {label:'Employee ID',key:'employeeId',ph:'EMP-001'},
                  {label:'Department',key:'department',ph:'Operations'},
                  {label:'Boarding Stop',key:'boardingStopName',ph:'Marina Walk'},
                  {label:'Alighting Stop',key:'alightingStopName',ph:'Business Bay Office'},
                ].map(({label,key,ph,required})=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
                    <input type="text" value={(formData as any)[key]} onChange={e=>setFormData(p=>({...p,[key]:e.target.value}))} placeholder={ph} required={required}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                  </div>
                ))}
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Adding...' : 'Add Passenger'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

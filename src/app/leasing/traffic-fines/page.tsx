'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface TrafficFine {
  id: string; fineNo?: string; contractId?: string; vehicleId?: string; driverId?: string; lesseeId?: string;
  violationDate: string; violationType: string; authority?: string; location?: string;
  fineAmount: number; discountAmount?: number; finalAmount?: number; currency?: string;
  dueDate?: string; billedToLessee?: boolean; billingStatus?: string; paidDate?: string; notes?: string;
  contract?: { contractNumber?: string };
}
interface Contract { id: string; contractNumber?: string; }

const VIOLATION_TYPES = ['SPEEDING','PARKING','RED_LIGHT','SALIK','REGISTRATION','OTHER'];
const AUTHORITIES     = ['RTA','DUBAI_POLICE','ABU_DHABI_POLICE','SHARJAH_POLICE','OTHER'];
const STATUS_COLORS: Record<string,string> = {
  PENDING:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  INVOICED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PAID:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ABSORBED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  DISPUTED: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
};

export default function TrafficFinesPage() {
  const [fines, setFines]           = useState<TrafficFine[]>([]);
  const [contracts, setContracts]   = useState<Contract[]>([]);
  const [filter, setFilter]         = useState('All');
  const [showModal, setShowModal]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');

  const emptyForm = { contractId:'', vehicleId:'', driverId:'', lesseeId:'', violationDate:'', violationType:'SPEEDING', authority:'RTA', location:'', fineAmount:'', discountAmount:'', dueDate:'', billedToLessee:true, notes:'' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== 'All' ? `?billingStatus=${filter}` : '';
      const [fRes, cRes] = await Promise.all([fetch(`/api/leasing/traffic-fines${params}`), fetch('/api/leasing/contracts-v2')]);
      const [fData, cData] = await Promise.all([fRes.json(), cRes.json()]);
      setFines(Array.isArray(fData) ? fData : []);
      setContracts(Array.isArray(cData) ? cData : []);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const finalAmount = parseFloat(form.fineAmount) - parseFloat(form.discountAmount || '0');
      const res = await fetch('/api/leasing/traffic-fines', { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, fineAmount: parseFloat(form.fineAmount), discountAmount: parseFloat(form.discountAmount||'0'), finalAmount,
          violationDate: new Date(form.violationDate).toISOString(), dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
          contractId: form.contractId || null, vehicleId: form.vehicleId || null }) });
      if (!res.ok) throw new Error();
      setShowModal(false); setForm(emptyForm); load();
    } catch { setError('Failed to save'); } finally { setSaving(false); }
  };

  const updateStatus = async (id: string, billingStatus: string) => {
    await fetch(`/api/leasing/traffic-fines/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ billingStatus }) });
    load();
  };

  const totalPending  = fines.filter(f=>f.billingStatus==='PENDING').reduce((s,f)=>s+Number(f.finalAmount??f.fineAmount),0);
  const totalInvoiced = fines.filter(f=>f.billingStatus==='INVOICED').reduce((s,f)=>s+Number(f.finalAmount??f.fineAmount),0);
  const totalPaid     = fines.filter(f=>f.billingStatus==='PAID').reduce((s,f)=>s+Number(f.finalAmount??f.fineAmount),0);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div><h1 className="text-4xl font-bold text-white mb-2">Traffic Violations</h1>
          <p className="text-slate-400">{fines.length} total fines  -  AED {totalPending.toLocaleString()} pending billing</p></div>
        <button onClick={()=>setShowModal(true)} className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">+ Log Fine</button>
      </div>
      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}
      <div className="grid grid-cols-3 gap-4">
        {[{l:'Pending Billing',v:totalPending,c:'text-amber-400'},{l:'Invoiced',v:totalInvoiced,c:'text-blue-400'},{l:'Collected',v:totalPaid,c:'text-emerald-400'}].map(({l,v,c})=>(
          <div key={l} className="bg-slate-800/50 border border-white/10 rounded-2xl p-5 text-center">
            <div className={`text-2xl font-bold ${c}`}>AED {v.toLocaleString()}</div>
            <div className="text-xs text-slate-400 mt-1">{l}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        {['All','PENDING','INVOICED','PAID','ABSORBED','DISPUTED'].map(s=>(
          <button key={s} onClick={()=>setFilter(s)} className={`px-4 py-2 rounded-lg text-sm border transition-all ${filter===s?'border-rose-500 bg-rose-500/10 text-white':'border-white/10 text-slate-400 hover:border-white/20'}`}>{s}</button>
        ))}
      </div>
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {fines.length === 0 ? <div className="text-center text-slate-400 py-12">No traffic fines found</div> : (
          <table className="w-full">
            <thead><tr className="border-b border-white/5">
              {['Fine No.','Contract','Date','Type','Authority','Location','Amount','Discount','Final','Billed?','Status','Action'].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {fines.map(f=>(
                <tr key={f.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-3 text-sm font-medium text-white">{f.fineNo ?? f.id.slice(0,8)}</td>
                  <td className="px-3 py-3 text-sm text-white">{f.contract?.contractNumber ?? '-'}</td>
                  <td className="px-3 py-3 text-sm text-slate-200">{new Date(f.violationDate).toLocaleDateString()}</td>
                  <td className="px-3 py-3 text-sm text-white">{f.violationType}</td>
                  <td className="px-3 py-3 text-sm text-white">{f.authority ?? '-'}</td>
                  <td className="px-3 py-3 text-sm text-white max-w-32 truncate">{f.location ?? '-'}</td>
                  <td className="px-3 py-3 text-sm text-white">AED {Number(f.fineAmount).toLocaleString()}</td>
                  <td className="px-3 py-3 text-sm text-emerald-400">{f.discountAmount ? `AED ${Number(f.discountAmount).toLocaleString()}` : '-'}</td>
                  <td className="px-3 py-3 text-sm font-medium text-amber-400">AED {Number(f.finalAmount??f.fineAmount).toLocaleString()}</td>
                  <td className="px-3 py-3 text-sm">{f.billedToLessee ? <span className="text-blue-400">Yes</span> : <span className="text-slate-300">No</span>}</td>
                  <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[f.billingStatus??'PENDING']}`}>{f.billingStatus??'PENDING'}</span></td>
                  <td className="px-3 py-3">
                    <select value={f.billingStatus??'PENDING'} onChange={e=>updateStatus(f.id,e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 border border-white/10 text-white focus:outline-none">
                      {['PENDING','INVOICED','PAID','ABSORBED','DISPUTED'].map(s=><option key={s} value={s}>{s}</option>)}
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
              <h2 className="text-2xl font-bold text-white">Log Traffic Fine</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Contract</label>
                  <select value={form.contractId} onChange={e=>setForm(p=>({...p,contractId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                    <option value="">Select contract</option>
                    {contracts.map(c=><option key={c.id} value={c.id}>{c.contractNumber??c.id.slice(0,8)}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Violation Date *</label>
                  <input type="datetime-local" value={form.violationDate} onChange={e=>setForm(p=>({...p,violationDate:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none"/></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Violation Type *</label>
                  <select value={form.violationType} onChange={e=>setForm(p=>({...p,violationType:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                    {VIOLATION_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Authority</label>
                  <select value={form.authority} onChange={e=>setForm(p=>({...p,authority:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-rose-500 focus:outline-none">
                    {AUTHORITIES.map(a=><option key={a} value={a}>{a}</option>)}
                  </select></div>
                {[{l:'Fine Amount (AED) *',k:'fineAmount',t:'number',ph:'500',req:true},{l:'Discount Amount',k:'discountAmount',t:'number',ph:'0'},{l:'Location',k:'location',t:'text',ph:'Sheikh Zayed Road'},{l:'Vehicle ID',k:'vehicleId',t:'text',ph:'Optional'},{l:'Driver ID',k:'driverId',t:'text',ph:'Optional'},{l:'Due Date',k:'dueDate',t:'date',ph:''}].map(({l,k,t,ph,req})=>(
                  <div key={k}><label className="block text-sm font-medium text-slate-300 mb-2">{l}</label>
                    <input type={t} value={(form as any)[k]} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph} required={req}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"/></div>
                ))}
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="billedToLessee" checked={form.billedToLessee} onChange={e=>setForm(p=>({...p,billedToLessee:e.target.checked}))} className="accent-rose-500 text-white"/>
                  <label htmlFor="billedToLessee" className="text-sm text-white">Bill to Lessee</label>
                </div>
              </div>
              <div><label className="block text-sm font-medium text-slate-300 mb-2">Notes</label>
                <textarea value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} rows={2} className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-rose-500 focus:outline-none"/></div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-50">{saving?'Saving...':'Log Fine'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

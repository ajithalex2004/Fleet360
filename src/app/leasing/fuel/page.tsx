'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Banknote, Fuel as FuelIcon, ReceiptText, Wallet } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';

interface FuelLog { id: string; contractId: string; vehicleId?: string; driverId?: string; fuelDate: string; liters: number; costPerLiter?: number; totalCost?: number; currency?: string; station?: string; mileageAtFuel?: number; fuelCardNo?: string; billedToLessee?: boolean; billingStatus?: string; notes?: string; contract?: { contractNumber?: string }; }
interface Contract { id: string; contractNumber?: string; lessee?: string; lesseeId?: string | null; }
interface Lessee { id: string; name: string; }

const STATUS_COLORS: Record<string,string> = {
  PENDING:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  INVOICED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PAID:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ABSORBED: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

export default function FuelPage() {
  const pathname = usePathname();
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';
  const [logs, setLogs]           = useState<FuelLog[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [lessees, setLessees]     = useState<Lessee[]>([]);
  const [filter, setFilter]       = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const emptyForm = { lesseeId:'', contractId:'', vehicleId:'', driverId:'', fuelDate:'', liters:'', costPerLiter:'', station:'', mileageAtFuel:'', fuelCardNo:'', billedToLessee:true, notes:'' };
  const [form, setForm] = useState(emptyForm);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter !== 'All' ? `?billingStatus=${filter}` : '';
      const [lRes, cRes, lesseesRes] = await Promise.all([fetch(`${apiBase}/fuel${params}`), fetch('/api/leasing/contracts-v2'), fetch('/api/leasing/lessees')]);
      const [lData, cData, lesseesData] = await Promise.all([lRes.json(), cRes.json(), lesseesRes.json()]);
      setLogs(Array.isArray(lData) ? lData : []);
      setContracts(Array.isArray(cData) ? cData : []);
      setLessees(Array.isArray(lesseesData) ? lesseesData : lesseesData.lessees ?? []);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }, [apiBase, filter]);

  const filteredContracts = form.lesseeId
    ? contracts.filter(contract => contract.lesseeId === form.lesseeId)
    : contracts;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (form.contractId && !filteredContracts.some(contract => contract.id === form.contractId)) {
      setForm(prev => ({ ...prev, contractId: '' }));
    }
  }, [filteredContracts, form.contractId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const totalCost = parseFloat(form.liters) * parseFloat(form.costPerLiter || '0');
      const res = await fetch(`${apiBase}/fuel`, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ...form, liters: parseFloat(form.liters), costPerLiter: parseFloat(form.costPerLiter||'0'), totalCost,
          mileageAtFuel: form.mileageAtFuel ? parseInt(form.mileageAtFuel) : null,
          fuelDate: new Date(form.fuelDate).toISOString(), vehicleId: form.vehicleId||null, driverId: form.driverId||null }) });
      if (!res.ok) throw new Error();
      setShowModal(false); setForm(emptyForm); load();
    } catch { setError('Failed to save'); } finally { setSaving(false); }
  };

  const updateStatus = async (id: string, billingStatus: string) => {
    await fetch(`${apiBase}/fuel/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ billingStatus }) });
    load();
  };

  const totalPending = logs.filter(l=>l.billingStatus==='PENDING').reduce((s,l)=>s+Number(l.totalCost??0),0);
  const totalLiters  = logs.reduce((s,l)=>s+Number(l.liters),0);

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading...</div></div>;

  if (isLegacyPath) {
    return (
      <LeasingBillingMigrationNotice
        title="Leasing fuel chargebacks"
        financeHref="/finance/leasing-billing/fuel"
        description="Fuel logs that affect customer billing are now operated from Finance & Billing."
      />
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fuel Management"
        subtitle={`${logs.length} logs • ${totalLiters.toFixed(0)}L total • AED ${totalPending.toLocaleString()} pending`}
        accent="amber"
        actions={(
          <button onClick={()=>setShowModal(true)} className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">+ Log Fuel</button>
        )}
      />
      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}
      <KpiGrid>
        <KpiCard label="Total Logs" value={logs.length} accent="slate" icon={ReceiptText} sub="Fuel entries" />
        <KpiCard label="Total Litres" value={`${totalLiters.toFixed(0)}L`} accent="blue" icon={FuelIcon} sub="Across selected logs" />
        <KpiCard label="Pending Billing" value={`AED ${totalPending.toLocaleString()}`} accent="amber" icon={Wallet} sub="Awaiting settlement" />
        <KpiCard label="Collected" value={`AED ${logs.filter(l=>l.billingStatus==='PAID').reduce((s,l)=>s+Number(l.totalCost??0),0).toLocaleString()}`} accent="emerald" icon={Banknote} sub="Recovered charges" />
      </KpiGrid>
      <div className="flex gap-3">
        {['All','PENDING','INVOICED','PAID','ABSORBED'].map(s=>(
          <button key={s} onClick={()=>setFilter(s)} className={`px-4 py-2 rounded-lg text-sm border transition-all ${filter===s?'border-amber-500 bg-amber-500/10 text-white':'border-white/10 text-slate-400 hover:border-white/20'}`}>{s}</button>
        ))}
      </div>
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {logs.length===0 ? <div className="text-center text-slate-400 py-12">No fuel logs found</div> : (
          <table className="w-full">
            <thead><tr className="border-b border-white/5">
              {['Contract','Date','Litres','Cost/L','Total','Station','Vehicle','Mileage','Card No','Bill?','Status','Action'].map(h=>(
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {logs.map(l=>(
                <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-3 text-sm text-white">{l.contract?.contractNumber??l.contractId.slice(0,8)}</td>
                  <td className="px-3 py-3 text-sm text-slate-200">{new Date(l.fuelDate).toLocaleDateString()}</td>
                  <td className="px-3 py-3 text-sm font-medium text-white">{Number(l.liters).toFixed(1)}L</td>
                  <td className="px-3 py-3 text-sm text-white">{l.costPerLiter ? `AED ${Number(l.costPerLiter).toFixed(3)}` : '-'}</td>
                  <td className="px-3 py-3 text-sm font-medium text-amber-400">{l.totalCost ? `AED ${Number(l.totalCost).toLocaleString()}` : '-'}</td>
                  <td className="px-3 py-3 text-sm text-white">{l.station??'-'}</td>
                  <td className="px-3 py-3 text-sm text-white">{l.vehicleId?.slice(0,8)??'-'}</td>
                  <td className="px-3 py-3 text-sm text-white">{l.mileageAtFuel?.toLocaleString()??'-'}</td>
                  <td className="px-3 py-3 text-sm font-mono text-slate-200">{l.fuelCardNo??'-'}</td>
                  <td className="px-3 py-3 text-sm">{l.billedToLessee?<span className="text-blue-400">Yes</span>:<span className="text-slate-300">No</span>}</td>
                  <td className="px-3 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[l.billingStatus??'PENDING']}`}>{l.billingStatus??'PENDING'}</span></td>
                  <td className="px-3 py-3">
                    <select value={l.billingStatus??'PENDING'} onChange={e=>updateStatus(l.id,e.target.value)}
                      className="text-xs px-2 py-1 rounded bg-slate-700 border border-white/10 text-white focus:outline-none">
                      {['PENDING','INVOICED','PAID','ABSORBED'].map(s=><option key={s} value={s}>{s}</option>)}
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
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Log Fuel</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Customer / Lessee</label>
                  <select value={form.lesseeId} onChange={e=>setForm(p=>({...p,lesseeId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-amber-500 focus:outline-none">
                    <option value="">All lessees</option>
                    {lessees.map(lessee=><option key={lessee.id} value={lessee.id}>{lessee.name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Contract *</label>
                  <select value={form.contractId} onChange={e=>setForm(p=>({...p,contractId:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-amber-500 focus:outline-none">
                    <option value="">Select contract</option>
                    {filteredContracts.map(c=><option key={c.id} value={c.id}>{c.contractNumber??c.id.slice(0,8)}{c.lessee ? ` - ${c.lessee}` : ''}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-slate-300 mb-2">Fuel Date *</label>
                  <input type="datetime-local" value={form.fuelDate} onChange={e=>setForm(p=>({...p,fuelDate:e.target.value}))} required
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-amber-500 focus:outline-none"/></div>
                {[{l:'Litres *',k:'liters',ph:'50',req:true},{l:'Cost per Litre (AED)',k:'costPerLiter',ph:'3.00'},{l:'Station',k:'station',ph:'ENOC Dubai Marina'},{l:'Mileage at Fill',k:'mileageAtFuel',ph:'45000'},{l:'Fuel Card No.',k:'fuelCardNo',ph:'FC-001'},{l:'Vehicle ID',k:'vehicleId',ph:'Optional'},{l:'Driver ID',k:'driverId',ph:'Optional'}].map(({l,k,ph,req})=>(
                  <div key={k}><label className="block text-sm font-medium text-slate-300 mb-2">{l}</label>
                    <input type="text" value={String(form[k as keyof typeof form] ?? '')} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))} placeholder={ph} required={req}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"/></div>
                ))}
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="billedToLessee" checked={form.billedToLessee} onChange={e=>setForm(p=>({...p,billedToLessee:e.target.checked}))} className="accent-amber-500 text-white"/>
                  <label htmlFor="billedToLessee" className="text-sm text-white">Bill to Lessee</label>
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-amber-600 to-orange-600 text-white hover:opacity-90 disabled:opacity-50">{saving?'Saving...':'Log Fuel'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface Lessee {
  id: string; name: string; type: string; licenseNo?: string; tradeLicense?: string;
  contactPerson?: string; email?: string; phone?: string; address?: string;
  nationality?: string; emiratesId?: string; createdAt?: string;
}
interface CreditSummary { creditLimit?: number; creditScore?: number; riskRating?: string; currentExposure?: number; }
interface DocSummary    { count: number; expiringSoon: number; }

export default function LesseesPage() {
  const [lessees, setLessees]         = useState<Lessee[]>([]);
  const [creditMap, setCreditMap]     = useState<Record<string, CreditSummary>>({});
  const [docMap, setDocMap]           = useState<Record<string, DocSummary>>({});
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');
  const [showModal, setShowModal]     = useState(false);
  const [editLessee, setEditLessee]   = useState<Lessee | null>(null);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const emptyForm = { name:'', type:'corporate', licenseNo:'', tradeLicense:'', contactPerson:'', email:'', phone:'', address:'', nationality:'', emiratesId:'' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [lRes, caRes, docRes] = await Promise.all([
        fetch('/api/leasing/lessees'),
        fetch('/api/leasing/credit-assessments'),
        fetch('/api/leasing/documents?entityType=LESSEE'),
      ]);
      const [lData, caData, docData] = await Promise.all([lRes.json(), caRes.json(), docRes.json()]);
      setLessees(Array.isArray(lData) ? lData : []);
      // Build credit map
      const cm: Record<string, CreditSummary> = {};
      if (Array.isArray(caData)) {
        caData.forEach((ca: any) => { cm[ca.lesseeId] = { creditLimit: ca.creditLimit, creditScore: ca.creditScore, riskRating: ca.riskRating, currentExposure: ca.currentExposure }; });
      }
      setCreditMap(cm);
      // Build doc map
      const dm: Record<string, DocSummary> = {};
      const now = new Date();
      if (Array.isArray(docData)) {
        docData.forEach((d: any) => {
          if (!dm[d.entityId]) dm[d.entityId] = { count: 0, expiringSoon: 0 };
          dm[d.entityId].count++;
          if (d.expiryDate) {
            const days = (new Date(d.expiryDate).getTime() - now.getTime()) / 86400000;
            if (days >= 0 && days <= 30) dm[d.entityId].expiringSoon++;
          }
        });
      }
      setDocMap(dm);
    } catch { setError('Failed to load'); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setEditLessee(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (l: Lessee) => {
    setEditLessee(l);
    setForm({ name:l.name, type:l.type, licenseNo:l.licenseNo??'', tradeLicense:l.tradeLicense??'', contactPerson:l.contactPerson??'', email:l.email??'', phone:l.phone??'', address:l.address??'', nationality:l.nationality??'', emiratesId:l.emiratesId??'' });
    setShowModal(true);
  };

  // Client-side type-specific validation that mirrors the server Zod schema.
  // Catches obvious omissions before the network round-trip.
  const validateForm = (): string | null => {
    if (!form.name.trim()) return 'Name is required.';
    if (form.type === 'corporate') {
      if (!form.tradeLicense.trim()) return 'Trade License is required for corporate lessees.';
    } else if (form.type === 'individual') {
      if (!form.emiratesId.trim() || form.emiratesId.replace(/[^a-zA-Z0-9]/g, '').length < 15) {
        return 'Emirates ID is required for individual lessees (≥15 characters).';
      }
      if (!form.nationality.trim()) return 'Nationality is required for individual lessees.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      // Strip fields that don't apply to the chosen type so the server schema
      // validation (discriminated union) accepts the payload.
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        type: form.type,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || undefined,
        contactPerson: form.contactPerson.trim() || undefined,
      };
      if (form.type === 'corporate') {
        payload.tradeLicense = form.tradeLicense.trim();
      } else {
        payload.emiratesId = form.emiratesId.trim();
        payload.nationality = form.nationality.trim();
        if (form.licenseNo.trim()) payload.licenseNo = form.licenseNo.trim();
      }

      const url    = editLessee ? `/api/leasing/lessees/${editLessee.id}` : '/api/leasing/lessees';
      const method = editLessee ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json?.details && Array.isArray(json.details)) {
          setError(json.details.map((d: any) => `${d.path}: ${d.message}`).join(', '));
        } else {
          setError(json?.error ?? `Save failed (${res.status})`);
        }
        return;
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const filtered = lessees.filter(l => {
    const matchType   = typeFilter === 'all' || l.type === typeFilter;
    const matchSearch = l.name.toLowerCase().includes(search.toLowerCase()) || (l.email??'').toLowerCase().includes(search.toLowerCase()) || (l.tradeLicense??'').includes(search);
    return matchType && matchSearch;
  });

  const RISK_COLORS: Record<string,string> = { LOW:'text-emerald-400', MEDIUM:'text-amber-400', HIGH:'text-rose-400' };

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading lessees...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Lessees</h1>
          <p className="text-slate-400">{lessees.filter(l=>l.type==='corporate').length} corporate, {lessees.filter(l=>l.type==='individual').length} individual  -  {lessees.length} total</p>
        </div>
        <button onClick={openNew} className="rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90">+ New Lessee</button>
      </div>
      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}
      <div className="flex gap-4 flex-wrap">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, trade license..."
          className="flex-1 min-w-48 max-w-sm px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"/>
        <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}
          className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none">
          <option value="all">All Types</option>
          <option value="corporate">Corporate</option>
          <option value="individual">Individual</option>
        </select>
      </div>
      <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {filtered.length===0 ? <div className="text-center text-slate-400 py-12">No lessees found</div> : (
          <table className="w-full">
            <thead><tr className="border-b border-white/5">
              {['Name','Type','KYC ID','Contact / Nationality','Phone','Email','Credit Limit','Risk','Exposure','Docs','Actions'].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map(l=>{
                const credit = creditMap[l.id];
                const docs   = docMap[l.id];
                return (
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-4 py-4 text-sm font-medium text-white">{l.name}</td>
                    <td className="px-4 py-4 text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${l.type==='corporate'?'bg-blue-500/20 text-blue-400':'bg-violet-500/20 text-violet-400'}`}>
                        {l.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-white">
                      {l.type === 'corporate'
                        ? (l.tradeLicense ? <><span className="text-slate-500 text-xs mr-1">TL</span>{l.tradeLicense}</> : '—')
                        : (l.emiratesId ? <><span className="text-slate-500 text-xs mr-1">EID</span>{l.emiratesId}</> : '—')}
                    </td>
                    <td className="px-4 py-4 text-sm text-white">
                      {l.type === 'corporate' ? (l.contactPerson ?? '—') : (l.nationality ?? '—')}
                    </td>
                    <td className="px-4 py-4 text-sm text-white">{l.phone??'-'}</td>
                    <td className="px-4 py-4 text-sm text-white">{l.email??'-'}</td>
                    <td className="px-4 py-4 text-sm font-medium text-white">{credit?.creditLimit?`AED ${Number(credit.creditLimit).toLocaleString()}`:'-'}</td>
                    <td className="px-4 py-4 text-sm font-bold"><span className={RISK_COLORS[credit?.riskRating??'']||'text-slate-200'}>{credit?.riskRating??'-'}</span></td>
                    <td className="px-4 py-4 text-sm text-white">{credit?.currentExposure?`AED ${Number(credit.currentExposure).toLocaleString()}`:'-'}</td>
                    <td className="px-4 py-4 text-sm">
                      {docs ? (
                        <span className={`text-xs ${docs.expiringSoon>0?'text-amber-400':'text-white'}`}>
                          {docs.count} docs{docs.expiringSoon>0?` (${docs.expiringSoon} expiring!)`:''}
                        </span>
                      ) : <span className="text-slate-300 text-xs">None</span>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={()=>openEdit(l)} className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30">Edit</button>
                        <a href={`/leasing/credit-assessments?lesseeId=${l.id}`} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">Credit</a>
                        <a href={`/leasing/documents?entityType=LESSEE&entityId=${l.id}`} className="text-xs px-2 py-1 rounded bg-slate-700 text-white border border-white/10 hover:bg-slate-600">Docs</a>
                        <a href={`/api/leasing/lessees/${l.id}/statement?lang=en&download=1`} className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30" title="Account statement (last 90 days, EN)">Stmt·EN</a>
                        <a href={`/api/leasing/lessees/${l.id}/statement?lang=ar&download=1`} className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30" title="كشف حساب آخر 90 يوماً (AR)">Stmt·AR</a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{editLessee?'Edit Lessee':'New Lessee'}</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            {/* Type selector (always visible — the rest of the form depends on this) */}
            <div className="mb-4 flex gap-2 p-1 bg-slate-900/60 rounded-xl border border-white/5">
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, type: 'corporate' }))}
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  form.type === 'corporate'
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="font-semibold">B2B — Corporate</div>
                <div className="text-xs opacity-75 mt-0.5">Trade license required</div>
              </button>
              <button
                type="button"
                onClick={() => setForm(p => ({ ...p, type: 'individual' }))}
                className={`flex-1 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                  form.type === 'individual'
                    ? 'bg-violet-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="font-semibold">B2C — Individual</div>
                <div className="text-xs opacity-75 mt-0.5">Emirates ID + nationality required</div>
              </button>
            </div>

            {/* Per-type KYC checklist banner */}
            <div className="mb-4 px-4 py-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs text-slate-400">
              {form.type === 'corporate' ? (
                <>
                  <span className="font-semibold text-slate-200">Corporate KYC checklist:</span>{' '}
                  Name, Trade License (required) · Contact person, email, phone (recommended) ·
                  Upload trade license + MoA via the Documents page after creation.
                </>
              ) : (
                <>
                  <span className="font-semibold text-slate-200">Individual KYC checklist:</span>{' '}
                  Full Name, Emirates ID, Nationality (required) · Phone, email (recommended) ·
                  Upload EID + driving license via the Documents page after creation.
                </>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    {form.type === 'corporate' ? 'Company Name *' : 'Full Name *'}
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e=>setForm(p=>({...p,name:e.target.value}))}
                    required
                    placeholder={form.type === 'corporate' ? 'e.g., Acme Trading LLC' : 'e.g., Ahmed Al-Mansouri'}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Corporate-only fields */}
                {form.type === 'corporate' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Trade License No. <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.tradeLicense}
                        onChange={e=>setForm(p=>({...p,tradeLicense:e.target.value}))}
                        required
                        placeholder="CN-1234567"
                        className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Contact Person</label>
                      <input
                        type="text"
                        value={form.contactPerson}
                        onChange={e=>setForm(p=>({...p,contactPerson:e.target.value}))}
                        placeholder="Ahmed Al-Mansouri"
                        className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </>
                )}

                {/* Individual-only fields */}
                {form.type === 'individual' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Emirates ID <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.emiratesId}
                        onChange={e=>setForm(p=>({...p,emiratesId:e.target.value}))}
                        required
                        placeholder="784-1234-1234567-1"
                        className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Nationality <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.nationality}
                        onChange={e=>setForm(p=>({...p,nationality:e.target.value}))}
                        required
                        placeholder="UAE"
                        className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">Driving License No.</label>
                      <input
                        type="text"
                        value={form.licenseNo}
                        onChange={e=>setForm(p=>({...p,licenseNo:e.target.value}))}
                        placeholder="DL-1234567"
                        className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  </>
                )}

                {/* Shared contact fields */}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e=>setForm(p=>({...p,phone:e.target.value}))}
                    placeholder="+971 4 000 0000"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={e=>setForm(p=>({...p,email:e.target.value}))}
                    placeholder={form.type === 'corporate' ? 'finance@company.com' : 'name@example.com'}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-300 mb-2">Address</label>
                  <textarea
                    value={form.address}
                    onChange={e=>setForm(p=>({...p,address:e.target.value}))}
                    rows={2}
                    placeholder="Office / residence address…"
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={()=>setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className={`px-6 py-2 rounded-lg text-white hover:opacity-90 disabled:opacity-50 ${
                    form.type === 'corporate'
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600'
                      : 'bg-gradient-to-r from-violet-600 to-purple-600'
                  }`}
                >
                  {saving ? 'Saving…' : (editLessee ? 'Update' : `Create ${form.type === 'corporate' ? 'B2B' : 'B2C'} Lessee`)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface BudgetSub {
  id: string; submission_no: string; fiscal_year: number; department: string;
  department_head: string; total_requested: string; total_approved: string | null;
  status: string; submitted_at: string | null; fm_reviewed_by: string | null;
  fm_notes: string | null; cfo_notes: string | null; rejection_reason: string | null;
  line_items: string; notes: string | null; created_at: string;
}

interface Comment {
  id: string; author: string; role: string; comment: string; action: string | null; created_at: string;
}

interface StatusCount { status: string; count: string; total_requested: string; }

const DEPARTMENTS = ['FLEET','RAC','LOGISTICS','STAFF_TRANSPORT','SCHOOL_BUS','AMBULANCE','ADMIN','FINANCE','HR','IT'];
const DEPT_ICONS: Record<string,string> = {
  FLEET:'🚗', RAC:'🔑', LOGISTICS:'🚛', STAFF_TRANSPORT:'🚌', SCHOOL_BUS:'🏫',
  AMBULANCE:'🚑', ADMIN:'🏢', FINANCE:'💰', HR:'👥', IT:'💻',
};
const STATUS_STYLE: Record<string,string> = {
  DRAFT:             'text-slate-400  bg-slate-700/50    border-slate-500/30',
  SUBMITTED:         'text-blue-400   bg-blue-900/20    border-blue-500/30',
  FM_REVIEW:         'text-amber-400  bg-amber-900/20   border-amber-500/30',
  CFO_REVIEW:        'text-purple-400 bg-purple-900/20  border-purple-500/30',
  APPROVED:          'text-emerald-400 bg-emerald-900/20 border-emerald-500/30',
  REJECTED:          'text-red-400    bg-red-900/20     border-red-500/30',
  REVISION_REQUIRED: 'text-orange-400 bg-orange-900/20  border-orange-500/30',
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
}

/* ── Create Submission Modal ── */
function CreateModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fiscalYear: new Date().getFullYear(), department: 'FLEET',
    departmentHead: '', notes: '',
  });
  const [lineItems, setLineItems] = useState([{ category: '', amount: 0, description: '', justification: '' }]);
  const [saving, setSaving] = useState(false);
  const inp = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500';

  const addLine = () => setLineItems(li => [...li, { category: '', amount: 0, description: '', justification: '' }]);
  const remLine = (i: number) => setLineItems(li => li.filter((_,idx) => idx !== i));
  const updLine = (i: number, k: string, v: string | number) => setLineItems(li => li.map((x,idx) => idx === i ? {...x, [k]: v} : x));

  const total = lineItems.reduce((s,i) => s + (parseFloat(String(i.amount)) || 0), 0);

  const save = async () => {
    if (!form.departmentHead) return;
    setSaving(true);
    const res = await fetch('/api/finance/budget-approvals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, lineItems }),
    });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); } else alert('Failed to create submission');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">Submit Budget Request</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Fiscal Year</label>
              <select value={form.fiscalYear} onChange={e => setForm(f=>({...f, fiscalYear: parseInt(e.target.value)}))} className={inp}>
                {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Department</label>
              <select value={form.department} onChange={e => setForm(f=>({...f, department: e.target.value}))} className={inp}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{DEPT_ICONS[d]} {d.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Department Head *</label>
              <input value={form.departmentHead} onChange={e => setForm(f=>({...f, departmentHead: e.target.value}))} placeholder="Full name" className={inp} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-400">Budget Line Items</label>
              <button onClick={addLine} className="text-xs text-purple-400 hover:text-purple-300">+ Add Line</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={li.category} onChange={e => updLine(i,'category',e.target.value)} placeholder="Category" className={`col-span-3 ${inp}`} />
                  <input type="number" value={li.amount} onChange={e => updLine(i,'amount',parseFloat(e.target.value)||0)} placeholder="Amount" className={`col-span-2 ${inp}`} />
                  <input value={li.description} onChange={e => updLine(i,'description',e.target.value)} placeholder="Description" className={`col-span-4 ${inp}`} />
                  <input value={li.justification} onChange={e => updLine(i,'justification',e.target.value)} placeholder="Justification" className={`col-span-2 ${inp}`} />
                  <button onClick={() => remLine(i)} className="col-span-1 text-red-400 hover:text-red-300 text-sm font-bold">×</button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-sm font-bold text-white">
              Total: AED {fmt(total)}
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes / Justification</label>
            <textarea value={form.notes} onChange={e => setForm(f=>({...f, notes: e.target.value}))} rows={2}
              className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-white/10">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-white/10 text-sm text-slate-400 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save as Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Submission Drawer ── */
function SubDrawer({ sub, onClose, onRefresh }: { sub: BudgetSub; onClose: () => void; onRefresh: () => void }) {
  const [detail, setDetail] = useState<(BudgetSub & { comments: Comment[] }) | null>(null);
  const [decision, setDecision] = useState('APPROVE');
  const [notes, setNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/finance/budget-approvals?id=${sub.id}`).then(r=>r.json()).then(setDetail);
  }, [sub.id]);

  const doAction = async (action: string, payload: Record<string,unknown>) => {
    setSaving(true);
    await fetch('/api/finance/budget-approvals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    setSaving(false);
    onRefresh();
    // Re-fetch detail
    fetch(`/api/finance/budget-approvals?id=${sub.id}`).then(r=>r.json()).then(setDetail);
  };

  const lineItems = (() => { try { return JSON.parse(detail?.line_items ?? '[]'); } catch { return []; } })();

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
      <div className="w-[600px] bg-slate-900 border-l border-white/10 flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h2 className="text-lg font-bold text-white">{sub.submission_no}</h2>
            <p className="text-xs text-slate-400">{DEPT_ICONS[sub.department]} {sub.department.replace('_',' ')} · FY {sub.fiscal_year}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[sub.status] ?? ''}`}>{sub.status.replace('_',' ')}</span>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-xl ml-2">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Amounts */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-800/60 rounded-xl p-3">
              <p className="text-xs text-slate-400">Requested</p>
              <p className="text-xl font-bold text-white">AED {fmt(parseFloat(sub.total_requested))}</p>
            </div>
            {sub.total_approved && (
              <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-slate-400">Approved</p>
                <p className="text-xl font-bold text-emerald-400">AED {fmt(parseFloat(sub.total_approved))}</p>
              </div>
            )}
          </div>

          {/* Line Items */}
          {lineItems.length > 0 && (
            <div className="bg-slate-800/40 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/10 text-xs font-bold text-slate-400 uppercase">Budget Lines</div>
              <table className="w-full text-sm">
                <thead><tr className="text-slate-500 text-xs"><th className="text-left px-3 py-1.5">Category</th><th className="text-left px-3 py-1.5">Description</th><th className="text-right px-3 py-1.5">Amount</th></tr></thead>
                <tbody>
                  {lineItems.map((li: Record<string,unknown>, i: number) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 text-slate-300">{String(li.category)}</td>
                      <td className="px-3 py-1.5 text-slate-400 text-xs">{String(li.description)}</td>
                      <td className="px-3 py-1.5 text-right text-slate-200">AED {fmt(parseFloat(String(li.amount)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Comments/Timeline */}
          {detail?.comments && detail.comments.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-2">Approval Trail</p>
              <div className="space-y-2">
                {detail.comments.map(c => (
                  <div key={c.id} className="flex gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${c.role === 'CFO' ? 'bg-purple-700' : c.role === 'FM' ? 'bg-blue-700' : 'bg-slate-700'}`}>
                      {c.role === 'SYSTEM' ? '⚙' : c.author[0]}
                    </div>
                    <div className="flex-1 bg-slate-800/40 rounded-xl px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white">{c.author}</span>
                        <span className="text-xs text-slate-500">{c.role}</span>
                        <span className="text-xs text-slate-600 ml-auto">{c.created_at.slice(0,10)}</span>
                      </div>
                      {c.action && <p className="text-xs text-purple-400 mt-0.5">{c.action.replace('_',' ')}</p>}
                      <p className="text-sm text-slate-300 mt-1">{c.comment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Panel */}
          {(sub.status === 'SUBMITTED' || sub.status === 'FM_REVIEW') && (
            <div className="bg-blue-900/10 border border-blue-500/20 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-blue-300">Finance Manager Review</p>
              <div className="grid grid-cols-3 gap-2">
                {['APPROVE','REJECT','REVISION'].map(d => (
                  <button key={d} onClick={() => setDecision(d)}
                    className={`py-1.5 rounded-lg text-xs font-medium transition-all border ${decision === d ? 'bg-blue-600 text-white border-blue-500' : 'text-slate-400 border-white/10 hover:text-white'}`}>
                    {d}
                  </button>
                ))}
              </div>
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Approved amount (default: ${fmt(parseFloat(sub.total_requested))})`}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="FM notes..."
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500" />
              <button onClick={() => doAction('fm_review', { submissionId: sub.id, decision, notes, approvedAmount: amount || null, reviewedBy: 'Finance Manager' })}
                disabled={saving}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
                {saving ? 'Submitting…' : `FM ${decision} Budget`}
              </button>
            </div>
          )}

          {sub.status === 'CFO_REVIEW' && (
            <div className="bg-purple-900/10 border border-purple-500/20 rounded-xl p-4 space-y-3">
              <p className="text-xs font-bold text-purple-300">CFO Decision Required (Budget &gt; AED 500K)</p>
              <div className="grid grid-cols-2 gap-2">
                {['APPROVE','REJECT'].map(d => (
                  <button key={d} onClick={() => setDecision(d)}
                    className={`py-1.5 rounded-lg text-xs font-medium border ${decision === d ? 'bg-purple-600 text-white border-purple-500' : 'text-slate-400 border-white/10 hover:text-white'}`}>
                    {d}
                  </button>
                ))}
              </div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="CFO decision notes..."
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-purple-500" />
              <button onClick={() => doAction('cfo_decision', { submissionId: sub.id, decision, notes, approvedAmount: amount || null, decidedBy: 'CFO' })}
                disabled={saving}
                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
                {saving ? 'Processing…' : `CFO ${decision} Budget`}
              </button>
            </div>
          )}

          {sub.status === 'DRAFT' && (
            <button onClick={() => doAction('submit', { submissionId: sub.id, performedBy: sub.department_head })}
              disabled={saving}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm disabled:opacity-50">
              {saving ? 'Submitting…' : '📤 Submit for FM Review'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BudgetApprovalsPage() {
  const [subs, setSubs] = useState<BudgetSub[]>([]);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSub, setSelectedSub] = useState<BudgetSub | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ year: String(selectedYear) });
    if (statusFilter) params.set('status', statusFilter);
    const res = await fetch(`/api/finance/budget-approvals?${params}`);
    if (res.ok) {
      const d = await res.json();
      setSubs(d.data ?? []);
      setStatusCounts(d.statusCounts ?? []);
    }
    setLoading(false);
  }, [selectedYear, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const pending = subs.filter(s => ['SUBMITTED','FM_REVIEW','CFO_REVIEW'].includes(s.status)).length;
  const approved = subs.filter(s => s.status === 'APPROVED').length;
  const totalApproved = subs.filter(s => s.status === 'APPROVED').reduce((sum, s) => sum + parseFloat(s.total_approved ?? s.total_requested), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Budget Approvals</h1>
          <p className="text-slate-400 text-sm mt-0.5">Department budget submissions with FM → CFO approval workflow</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
            className="bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500">
            {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl text-sm">
            + Submit Budget
          </button>
        </div>
      </div>

      {/* Workflow banner */}
      <div className="flex items-center gap-2 bg-slate-800/60 border border-white/10 rounded-2xl p-4">
        {['DRAFT → Dept saves draft', 'SUBMITTED → Sent to FM', 'FM_REVIEW → FM approves/rejects', 'CFO_REVIEW → Large budgets (>500K)', 'APPROVED ✓'].map((step, i, arr) => (
          <React.Fragment key={step}>
            <span className="text-xs text-slate-400">{step}</span>
            {i < arr.length - 1 && <span className="text-slate-600">→</span>}
          </React.Fragment>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Pending Review', value: pending, color: 'text-amber-400', note: 'Awaiting action' },
          { label: 'Approved', value: approved, color: 'text-emerald-400', note: 'This year' },
          { label: 'Total Approved', value: `AED ${fmt(totalApproved)}`, color: 'text-white', note: `FY ${selectedYear}` },
          { label: 'Submissions', value: subs.length, color: 'text-blue-400', note: 'All statuses' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-slate-900/60 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-slate-400">{kpi.label}</p>
            <p className={`text-2xl font-bold mt-1 ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{kpi.note}</p>
          </div>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['','DRAFT','SUBMITTED','FM_REVIEW','CFO_REVIEW','APPROVED','REJECTED','REVISION_REQUIRED'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${statusFilter === s ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white bg-slate-800'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? <div className="h-64 bg-slate-800/60 rounded-2xl animate-pulse" /> : (
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Submission No.</th>
                <th className="text-left px-4 py-3">Department</th>
                <th className="text-left px-4 py-3">Dept Head</th>
                <th className="text-left px-4 py-3 w-32">Status</th>
                <th className="text-right px-4 py-3">Requested</th>
                <th className="text-right px-4 py-3">Approved</th>
                <th className="text-left px-4 py-3">Created</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map(sub => (
                <tr key={sub.id} className="border-b border-white/5 hover:bg-slate-800/40 cursor-pointer" onClick={() => setSelectedSub(sub)}>
                  <td className="px-4 py-3 font-mono text-xs text-purple-400">{sub.submission_no}</td>
                  <td className="px-4 py-3 text-sm text-white">{DEPT_ICONS[sub.department]} {sub.department.replace('_',' ')}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{sub.department_head}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[sub.status] ?? ''}`}>
                      {sub.status.replace('_',' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-slate-300">AED {fmt(parseFloat(sub.total_requested))}</td>
                  <td className="px-4 py-3 text-right text-sm text-emerald-400">
                    {sub.total_approved ? `AED ${fmt(parseFloat(sub.total_approved))}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{sub.created_at.slice(0,10)}</td>
                  <td className="px-4 py-3">
                    <button className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg text-xs">View</button>
                  </td>
                </tr>
              ))}
              {subs.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No budget submissions for FY {selectedYear}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onSaved={load} />}
      {selectedSub && <SubDrawer sub={selectedSub} onClose={() => setSelectedSub(null)} onRefresh={load} />}
    </div>
  );
}

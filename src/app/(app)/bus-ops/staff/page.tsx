'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { UserCog, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/bus-ops/theme';
import FleetDataGrid, { type DataGridColumn } from '@/components/ui/FleetDataGrid';

interface StaffMember {
  id: string; employeeId?: string; name: string; department?: string; designation?: string;
  contactNumber?: string; email?: string; residenceArea?: string;
  defaultRouteId?: string; defaultStopName?: string; shiftType?: string;
  transportType?: string; isActive?: boolean;
}
interface Route { id: string; name: string; }

const SHIFT_TYPES      = ['MORNING','EVENING','BOTH'];
const TRANSPORT_TYPES  = ['BUS','TAXI','SELF'];

export default function StaffPage() {
  const [staff, setStaff]           = useState<StaffMember[]>([]);
  const [routes, setRoutes]         = useState<Route[]>([]);
  const [showModal, setShowModal]   = useState(false);
  const [editMember, setEditMember] = useState<StaffMember | null>(null);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const emptyForm = { employeeId:'', name:'', department:'', designation:'', contactNumber:'', email:'', residenceArea:'', defaultRouteId:'', defaultStopName:'', shiftType:'MORNING', transportType:'BUS', isActive:true };
  const [formData, setFormData] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, rRes] = await Promise.all([fetch('/api/bus-ops/staff'), fetch('/api/bus-ops/routes')]);
      const [sData, rData] = await Promise.all([sRes.json(), rRes.json()]);
      setStaff(Array.isArray(sData) ? sData : []);
      setRoutes(Array.isArray(rData) ? rData : []);
    } catch { setError('Failed to load'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openNew = () => { setEditMember(null); setFormData(emptyForm as any); setShowModal(true); };
  const openEdit = (m: StaffMember) => {
    setEditMember(m);
    setFormData({ employeeId:m.employeeId??'', name:m.name, department:m.department??'', designation:m.designation??'', contactNumber:m.contactNumber??'', email:m.email??'', residenceArea:m.residenceArea??'', defaultRouteId:m.defaultRouteId??'', defaultStopName:m.defaultStopName??'', shiftType:m.shiftType??'MORNING', transportType:m.transportType??'BUS', isActive:m.isActive??true });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...formData, employeeId: formData.employeeId || null, defaultRouteId: formData.defaultRouteId || null };
      const url    = editMember ? `/api/bus-ops/staff/${editMember.id}` : '/api/bus-ops/staff';
      const method = editMember ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (!res.ok) throw new Error();
      setShowModal(false);
      loadData();
    } catch { setError('Failed to save'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (m: StaffMember) => {
    await fetch(`/api/bus-ops/staff/${m.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ isActive: !m.isActive }) });
    loadData();
  };

  const staffColumns: DataGridColumn<StaffMember>[] = [
    { key: 'employeeId', header: 'Emp ID', accessor: m => m.employeeId,
      render: m => <span className="font-mono text-white">{m.employeeId ?? '-'}</span> },
    { key: 'name', header: 'Name', accessor: m => m.name,
      render: m => <span className="font-medium text-white">{m.name}</span> },
    { key: 'department', header: 'Dept / Role', accessor: m => m.department, filter: 'select',
      render: m => (
        <div>
          <div>{m.department ?? '-'}</div>
          <div className="text-xs text-slate-300">{m.designation ?? ''}</div>
        </div>
      ) },
    { key: 'contact', header: 'Contact', accessor: m => m.contactNumber,
      render: m => (
        <div>
          <div>{m.contactNumber ?? '-'}</div>
          <div className="text-xs text-slate-300">{m.email ?? ''}</div>
        </div>
      ) },
    { key: 'residenceArea', header: 'Residence', accessor: m => m.residenceArea },
    { key: 'route', header: 'Route', accessor: m => m.defaultRouteId ? (routes.find(r=>r.id===m.defaultRouteId)?.name ?? m.defaultRouteId) : '',
      render: m => (
        <div>
          <div>{m.defaultRouteId ? (routes.find(r=>r.id===m.defaultRouteId)?.name ?? m.defaultRouteId.slice(0,8)) : '-'}</div>
          {m.defaultStopName && <div className="text-xs text-slate-300">{m.defaultStopName}</div>}
        </div>
      ) },
    { key: 'shiftType', header: 'Shift', accessor: m => m.shiftType, filter: 'select' },
    { key: 'transportType', header: 'Transport', accessor: m => m.transportType, filter: 'select',
      render: m => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${m.transportType==='BUS' ? 'bg-emerald-500/20 text-emerald-400' : m.transportType==='TAXI' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-500/20 text-slate-200'}`}>
          {m.transportType ?? 'BUS'}
        </span>
      ) },
    { key: 'isActive', header: 'Status', accessor: m => m.isActive ? 'Active' : 'Inactive', filter: 'select',
      render: m => m.isActive
        ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Active</span>
        : <span className="px-2 py-0.5 rounded-full text-xs bg-slate-500/20 text-slate-200 border border-slate-500/30">Inactive</span> },
    { key: 'actions', header: 'Actions', filter: false, sortable: false,
      render: m => (
        <div className="flex gap-2">
          <button onClick={()=>openEdit(m)} className="text-xs px-2 py-1 rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">Edit</button>
          <button onClick={()=>toggleActive(m)} className="text-xs px-2 py-1 rounded bg-slate-700 text-white border border-white/10 hover:bg-slate-600">
            {m.isActive ? 'Suspend' : 'Activate'}
          </button>
        </div>
      ) },
  ];

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400 animate-pulse">Loading staff...</div></div>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Staff Register"
        subtitle={`${staff.filter(s=>s.isActive).length} active · ${staff.length} total on transport`}
        icon={UserCog}
        accent="violet"
        actions={
          <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <UserPlus className="w-4 h-4" /> Register Staff
          </button>
        }
      />

      {error && <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">{error}</div>}

      <FleetDataGrid
        gridName="StaffRegister"
        rows={staff}
        getRowId={m => m.id}
        loading={false}
        emptyMessage="No staff found"
        columns={staffColumns}
        numbered
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        toolbar={{
          exportName: 'staff-register',
          title: 'Staff Register',
          actions: selectedIds.size > 0 ? (
            <span className="inline-flex items-center gap-2 text-xs text-violet-300">
              {selectedIds.size} selected
              <button type="button" onClick={() => setSelectedIds(new Set())}
                className="text-slate-400 hover:text-white underline underline-offset-2">
                Clear
              </button>
            </span>
          ) : undefined,
        }}
      />

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-800/95 border border-white/10 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">{editMember ? 'Edit Staff' : 'Register Staff'}</h2>
              <button onClick={()=>setShowModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  {label:'Full Name *',key:'name',type:'text',ph:'Ahmed Al-Mansouri',required:true},
                  {label:'Employee ID',key:'employeeId',type:'text',ph:'EMP-001'},
                  {label:'Department',key:'department',type:'text',ph:'Operations'},
                  {label:'Designation',key:'designation',type:'text',ph:'Senior Engineer'},
                  {label:'Contact Number',key:'contactNumber',type:'text',ph:'+971 50 000 0000'},
                  {label:'Email',key:'email',type:'email',ph:'emp@company.com'},
                  {label:'Residence Area',key:'residenceArea',type:'text',ph:'Dubai Marina'},
                  {label:'Default Stop',key:'defaultStopName',type:'text',ph:'Marina Walk Bus Stop'},
                ].map(({label,key,type,ph,required})=>(
                  <div key={key}>
                    <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
                    <input type={type} value={(formData as any)[key]} onChange={e=>setFormData(p=>({...p,[key]:e.target.value}))} placeholder={ph} required={required}
                      className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none" />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Default Route</label>
                  <select value={formData.defaultRouteId} onChange={e=>setFormData(p=>({...p,defaultRouteId:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    <option value="">None</option>
                    {routes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Shift</label>
                  <select value={formData.shiftType} onChange={e=>setFormData(p=>({...p,shiftType:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {SHIFT_TYPES.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Transport Type</label>
                  <select value={formData.transportType} onChange={e=>setFormData(p=>({...p,transportType:e.target.value}))}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-white/10 text-white focus:border-violet-500 focus:outline-none">
                    {TRANSPORT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <input type="checkbox" id="isActive" checked={formData.isActive as boolean} onChange={e=>setFormData(p=>({...p,isActive:e.target.checked}))} className="w-4 h-4 accent-violet-500 text-white" />
                  <label htmlFor="isActive" className="text-sm text-white">Active on Transport</label>
                </div>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button type="button" onClick={()=>setShowModal(false)} className="px-6 py-2 rounded-lg border border-white/10 text-white hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:opacity-90 disabled:opacity-50">
                  {saving ? 'Saving...' : editMember ? 'Update' : 'Register'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

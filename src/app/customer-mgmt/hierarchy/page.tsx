'use client';
import React, { useState, useEffect, useCallback } from 'react';

interface HNode { id: string; name: string; code?: string; description?: string; level: string; parentId?: string; isActive?: boolean; children?: HNode[]; }

const LEVEL_CONFIG = {
  REGION:     { label: 'Region',     color: 'from-blue-500 to-indigo-600',   bg: 'bg-blue-500/10 border-blue-500/30',     next: 'DEPARTMENT' },
  DEPARTMENT: { label: 'Department', color: 'from-violet-500 to-purple-600', bg: 'bg-violet-500/10 border-violet-500/30', next: 'UNIT' },
  UNIT:       { label: 'Unit',       color: 'from-emerald-500 to-teal-600',  bg: 'bg-emerald-500/10 border-emerald-500/30',next: null },
};

export default function HierarchyPage() {
  const [regions, setRegions]   = useState<HNode[]>([]);
  const [selRegion, setSelRegion] = useState<HNode | null>(null);
  const [depts, setDepts]       = useState<HNode[]>([]);
  const [selDept, setSelDept]   = useState<HNode | null>(null);
  const [units, setUnits]       = useState<HNode[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [modalLevel, setModalLevel] = useState<'REGION'|'DEPARTMENT'|'UNIT'>('REGION');
  const [modalParent, setModalParent] = useState<HNode | null>(null);
  const [editNode, setEditNode]  = useState<HNode | null>(null);
  const [form, setForm]          = useState({ name:'', code:'', description:'' });
  const [saving, setSaving]      = useState(false);
  const [error, setError]        = useState('');

  const loadRegions = useCallback(async () => {
    const res = await fetch('/api/customer-hierarchy?level=REGION');
    const d   = await res.json();
    setRegions(Array.isArray(d) ? d : []);
  }, []);

  const loadDepts = useCallback(async (regionId: string) => {
    const res = await fetch(`/api/customer-hierarchy?level=DEPARTMENT&parentId=${regionId}`);
    const d   = await res.json();
    setDepts(Array.isArray(d) ? d : []);
    setSelDept(null); setUnits([]);
  }, []);

  const loadUnits = useCallback(async (deptId: string) => {
    const res = await fetch(`/api/customer-hierarchy?level=UNIT&parentId=${deptId}`);
    const d   = await res.json();
    setUnits(Array.isArray(d) ? d : []);
  }, []);

  useEffect(() => { loadRegions(); }, [loadRegions]);

  const openAdd = (level: 'REGION'|'DEPARTMENT'|'UNIT', parent: HNode | null = null) => {
    setEditNode(null); setModalLevel(level); setModalParent(parent);
    setForm({ name:'', code:'', description:'' }); setError('');
    setShowModal(true);
  };
  const openEdit = (node: HNode) => {
    setEditNode(node); setModalLevel(node.level as any);
    setForm({ name: node.name, code: node.code ?? '', description: node.description ?? '' });
    setError(''); setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        level:    editNode ? editNode.level : modalLevel,
        parentId: editNode ? editNode.parentId : (modalParent?.id ?? null),
      };
      const url    = editNode ? `/api/customer-hierarchy/${editNode.id}` : '/api/customer-hierarchy';
      const method = editNode ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Save failed'); }
      setShowModal(false);
      await loadRegions();
      if (selRegion) await loadDepts(selRegion.id);
      if (selDept)   await loadUnits(selDept.id);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const deactivate = async (node: HNode) => {
    if (!confirm(`Deactivate "${node.name}"?`)) return;
    await fetch(`/api/customer-hierarchy/${node.id}`, { method:'DELETE' });
    await loadRegions();
    if (selRegion) await loadDepts(selRegion.id);
    if (selDept)   await loadUnits(selDept.id);
  };

  const NodeCard = ({ node, level, onClick, isSelected, onEdit, onAdd, onDel, addLabel }:
    { node:HNode; level:string; onClick:()=>void; isSelected:boolean; onEdit:()=>void; onAdd?:()=>void; onDel:()=>void; addLabel?:string }) => {
    const cfg = LEVEL_CONFIG[level as keyof typeof LEVEL_CONFIG];
    return (
      <div onClick={onClick}
        className={`border rounded-xl p-3 cursor-pointer transition-all hover:shadow-md ${isSelected ? `${cfg.bg} border-2` : 'bg-slate-800/50 border-white/10 hover:border-white/20'}`}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${node.isActive ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="text-sm font-medium text-white truncate">{node.name}</span>
          </div>
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            {onAdd && (
              <button onClick={onAdd} title={`Add ${addLabel}`}
                className="w-6 h-6 rounded bg-blue-500/20 text-blue-400 text-xs hover:bg-blue-500/30 flex items-center justify-center">+</button>
            )}
            <button onClick={onEdit} className="w-6 h-6 rounded bg-slate-600 text-slate-300 text-xs hover:bg-slate-500 flex items-center justify-center">E</button>
            <button onClick={onDel} className="w-6 h-6 rounded bg-rose-500/20 text-rose-400 text-xs hover:bg-rose-500/30 flex items-center justify-center">X</button>
          </div>
        </div>
        {node.code && <div className="text-xs font-mono text-slate-500">{node.code}</div>}
        {node.description && <div className="text-xs text-slate-400 mt-1 truncate">{node.description}</div>}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Hierarchy Setup</h1>
          <p className="text-slate-400 text-sm mt-0.5">3-level customer hierarchy: Region &rarr; Department &rarr; Unit</p>
        </div>
      </div>

      {/* 3-column hierarchy view */}
      <div className="grid grid-cols-3 gap-6">
        {/* REGIONS */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <h2 className="text-sm font-semibold text-white">Regions ({regions.length})</h2>
            </div>
            <button onClick={() => openAdd('REGION')}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30">
              + Add Region
            </button>
          </div>
          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {regions.length === 0 ? (
              <div className="text-center text-slate-500 py-8 border border-dashed border-white/10 rounded-xl text-sm">
                No regions yet. Click "+ Add Region" to start.
              </div>
            ) : regions.map(r => (
              <NodeCard key={r.id} node={r} level="REGION"
                isSelected={selRegion?.id === r.id}
                onClick={() => { setSelRegion(r); loadDepts(r.id); }}
                onEdit={() => openEdit(r)}
                onAdd={() => openAdd('DEPARTMENT', r)}
                onDel={() => deactivate(r)}
                addLabel="Department" />
            ))}
          </div>
        </div>

        {/* DEPARTMENTS */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-violet-500" />
              <h2 className="text-sm font-semibold text-white">
                Departments ({depts.length})
                {selRegion && <span className="ml-1 text-slate-500 font-normal text-xs">in {selRegion.name}</span>}
              </h2>
            </div>
            {selRegion && (
              <button onClick={() => openAdd('DEPARTMENT', selRegion)}
                className="text-xs px-3 py-1.5 rounded-lg bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30">
                + Add Dept
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {!selRegion ? (
              <div className="text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl text-sm">
                Select a Region to view departments
              </div>
            ) : depts.length === 0 ? (
              <div className="text-center text-slate-500 py-8 border border-dashed border-white/10 rounded-xl text-sm">
                No departments in {selRegion.name}
              </div>
            ) : depts.map(d => (
              <NodeCard key={d.id} node={d} level="DEPARTMENT"
                isSelected={selDept?.id === d.id}
                onClick={() => { setSelDept(d); loadUnits(d.id); }}
                onEdit={() => openEdit(d)}
                onAdd={() => openAdd('UNIT', d)}
                onDel={() => deactivate(d)}
                addLabel="Unit" />
            ))}
          </div>
        </div>

        {/* UNITS */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-semibold text-white">
                Units ({units.length})
                {selDept && <span className="ml-1 text-slate-500 font-normal text-xs">in {selDept.name}</span>}
              </h2>
            </div>
            {selDept && (
              <button onClick={() => openAdd('UNIT', selDept)}
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30">
                + Add Unit
              </button>
            )}
          </div>
          <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
            {!selDept ? (
              <div className="text-center text-slate-600 py-8 border border-dashed border-white/10 rounded-xl text-sm">
                Select a Department to view units
              </div>
            ) : units.length === 0 ? (
              <div className="text-center text-slate-500 py-8 border border-dashed border-white/10 rounded-xl text-sm">
                No units in {selDept.name}
              </div>
            ) : units.map(u => (
              <NodeCard key={u.id} node={u} level="UNIT"
                isSelected={false}
                onClick={() => {}}
                onEdit={() => openEdit(u)}
                onDel={() => deactivate(u)} />
            ))}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-slate-800 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">
                {editNode ? 'Edit' : 'Add'} {LEVEL_CONFIG[modalLevel]?.label}
                {modalParent && !editNode && <span className="text-slate-400 font-normal text-sm ml-2">under {modalParent.name}</span>}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            {error && <div className="mb-4 px-3 py-2 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">{error}</div>}
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Name <span className="text-rose-400">*</span></label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({...p, name: e.target.value}))} required
                  placeholder={`Enter ${LEVEL_CONFIG[modalLevel]?.label.toLowerCase()} name`}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Code</label>
                <input type="text" value={form.code} onChange={e => setForm(p => ({...p, code: e.target.value}))}
                  placeholder="Short code (e.g. ABD, DXB)"
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setForm(p => ({...p, description: e.target.value}))} rows={2}
                  placeholder="Optional description"
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-700 border border-white/10 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none" />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-5 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5">Cancel</button>
                <button type="submit" disabled={saving}
                  className={`px-5 py-2 rounded-lg text-white font-medium hover:opacity-90 disabled:opacity-50 bg-gradient-to-r ${LEVEL_CONFIG[modalLevel]?.color}`}>
                  {saving ? 'Saving...' : editNode ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

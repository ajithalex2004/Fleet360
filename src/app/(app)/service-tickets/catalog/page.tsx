'use client';

/**
 * /service-tickets/catalog — Field Service Management Service Catalog & SLA master.
 *
 * Service Categories and the Service Types under each, with each type's
 * priority (P1–P4), trigger and SLA timers (response, on-site arrival,
 * resolution). The New Request form reads priority and SLA from here.
 * Everyone in the module can view; tenant admins can add, edit and delete.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ListTree, Plus, Pencil, Trash2, ChevronLeft, Download, X, Check, AlertCircle, Info,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import SmartDataGrid, { type SmartDataGridColumn, type KpiTile } from '@/components/ui/SmartDataGrid';
import { PRIORITY_TIERS, formatSlaHours, priorityLabel } from '@/lib/service-tickets/priority-tiers';
import type { TicketPriority } from '@/types/service-tickets';

interface CatalogSla { responseHours: number | null; onSiteHours: number | null; resolutionHours: number | null }
interface CatalogType {
  id: string; key: string; name: string; categoryId: string; priority: TicketPriority;
  trigger: string | null; prefix: string; sortOrder: number; sla: CatalogSla;
}
interface CatalogCategory { id: string; key: string; name: string; description: string | null; sortOrder: number; types: CatalogType[] }
interface CatalogResponse {
  ok: boolean; categories: CatalogCategory[]; canEdit: boolean;
  standard: { categories: number; types: number }; error?: string;
}
type Row = CatalogType & { categoryName: string };

const PRIORITY_STYLE: Record<TicketPriority, string> = {
  Critical: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  High:     'bg-amber-500/20 text-amber-300 border-amber-500/40',
  Medium:   'bg-blue-500/20 text-blue-300 border-blue-500/40',
  Low:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const inputCls = 'w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500';
const btnPrimary = 'inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-all';
const btnGhost = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5 disabled:opacity-50';

async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/service-tickets/catalog', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function ServiceCatalogPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>('all');
  const [categoryEdit, setCategoryEdit] = useState<{ id: string | null; name: string; description: string } | null>(null);
  const [typeEdit, setTypeEdit] = useState<Row | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/service-tickets/catalog');
      const json = (await res.json()) as CatalogResponse;
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load the service catalog');
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load the service catalog');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const canEdit = !!data?.canEdit;
  useEffect(() => {
    if (selected !== 'all' && !categories.some((c) => c.id === selected)) setSelected('all');
  }, [categories, selected]);

  const rows: Row[] = useMemo(
    () => categories.flatMap((c) => c.types.map((t) => ({ ...t, categoryName: c.name })))
      .filter((r) => selected === 'all' || r.categoryId === selected),
    [categories, selected],
  );
  const totalTypes = categories.reduce((n, c) => n + c.types.length, 0);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const installStandard = () => {
    const n = data?.standard;
    if (!window.confirm(
      `Load the standard Field Service catalogue (${n?.categories ?? 11} categories, ${n?.types ?? 33} service types)?\n\n`
      + 'This archives the Facilities categories (Hard, Soft, Workplace, Security & safety). Existing requests keep their type, '
      + 'and categories or types you already have are left as they are.',
    )) return;
    void run(() => post({ action: 'installStandard' }), 'Standard catalogue loaded.');
  };

  const deleteCategory = (c: CatalogCategory) => {
    if (!window.confirm(`Delete the category "${c.name}" and its ${c.types.length} service type(s)?\n\nExisting requests keep their type.`)) return;
    void run(() => post({ action: 'deleteCategory', id: c.id }), `Deleted ${c.name}.`);
  };

  const deleteType = useCallback((r: Row) => {
    if (!window.confirm(`Delete the service type "${r.name}"?\n\nExisting requests keep their type.`)) return;
    void run(() => post({ action: 'deleteType', id: r.id }), `Deleted ${r.name}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columns = useMemo<SmartDataGridColumn<Row>[]>(() => [
    {
      key: 'category', header: 'Service category', filter: 'select', accessor: (r) => r.categoryName,
      render: (r) => <span className="text-xs text-slate-300 whitespace-nowrap">{r.categoryName}</span>,
    },
    {
      key: 'name', header: 'Service type', accessor: (r) => r.name,
      render: (r) => (
        <div className="min-w-[220px]">
          <div className="text-sm font-semibold text-white">{r.name}</div>
          {r.prefix && <div className="text-[10px] font-mono text-slate-500">Request prefix {r.prefix}</div>}
        </div>
      ),
    },
    {
      key: 'priority', header: 'Priority', filter: 'select',
      selectOptions: PRIORITY_TIERS.map((p) => p.label),
      accessor: (r) => priorityLabel(r.priority),
      render: (r) => (
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${PRIORITY_STYLE[r.priority]}`}>
          {priorityLabel(r.priority)}
        </span>
      ),
    },
    {
      key: 'response', header: 'SLA response', align: 'right', filter: false,
      accessor: (r) => r.sla.responseHours,
      render: (r) => <span className="text-sm tabular-nums text-slate-200 whitespace-nowrap">{formatSlaHours(r.sla.responseHours)}</span>,
    },
    {
      key: 'onsite', header: 'SLA on-site arrival', align: 'right', filter: false,
      accessor: (r) => r.sla.onSiteHours,
      render: (r) => <span className="text-sm tabular-nums text-slate-200 whitespace-nowrap">{formatSlaHours(r.sla.onSiteHours)}</span>,
    },
    {
      key: 'resolution', header: 'SLA resolution', align: 'right', filter: false,
      accessor: (r) => r.sla.resolutionHours,
      render: (r) => <span className="text-sm tabular-nums text-slate-200 whitespace-nowrap">{formatSlaHours(r.sla.resolutionHours)}</span>,
    },
    {
      key: 'trigger', header: 'Trigger', accessor: (r) => r.trigger ?? '',
      render: (r) => <span className="text-xs text-slate-400">{r.trigger || '—'}</span>,
    },
    ...(canEdit ? [{
      key: 'actions', header: '', filter: false as const, sortable: false,
      render: (r: Row) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={btnGhost} onClick={() => setTypeEdit(r)} aria-label={`Edit ${r.name}`}>
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button type="button" className={`${btnGhost} text-rose-300`} onClick={() => deleteType(r)} aria-label={`Delete ${r.name}`}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    }] : []),
  ], [canEdit, deleteType]);

  // Until the first load lands, counts show "—" rather than a misleading 0.
  const loaded = data !== null;
  const kpis: KpiTile[] = useMemo(() => [
    { label: 'Service categories', value: loaded ? categories.length : '—', accent: 'violet' },
    { label: 'Service types', value: loaded ? totalTypes : '—', accent: 'sky' },
    ...PRIORITY_TIERS.map((p) => ({
      label: p.label,
      value: loaded ? categories.reduce((n, c) => n + c.types.filter((t) => t.priority === p.priority).length, 0) : '—',
      accent: (p.tier === 'P1' ? 'rose' : p.tier === 'P2' ? 'amber' : p.tier === 'P3' ? 'sky' : 'emerald') as KpiTile['accent'],
    })),
  ], [categories, totalTypes, loaded]);

  return (
    <div className="space-y-6 max-w-7xl">
      <PageHeader
        title="Service Catalog & SLA"
        subtitle="Service categories, the service types under each, and each type's priority and SLA timers. New requests take their priority and SLA from here."
        icon={ListTree}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            <Link href="/service-tickets" className={btnGhost}>
              <ChevronLeft className="w-3.5 h-3.5" /> Field Service Management
            </Link>
            {canEdit && (
              <button type="button" onClick={installStandard} disabled={busy} className={btnGhost}>
                <Download className="w-3.5 h-3.5" /> Load standard catalogue
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div role="alert" className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2 text-rose-300 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {notice && !error && (
        <div role="status" className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 text-emerald-300 text-sm">
          <Check className="w-4 h-4" /> {notice}
        </div>
      )}
      {loaded && !canEdit && (
        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> View only — a tenant administrator can change the catalogue.
        </p>
      )}

      {loaded && categories.length === 0 ? (
        <div className="sdg rounded-2xl border border-white/10 bg-slate-900/60 p-8 text-center space-y-3">
          <ListTree className="w-8 h-8 text-violet-400 mx-auto" />
          <h2 className="text-base font-semibold text-white">No service categories yet</h2>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Load the standard Field Service catalogue ({data?.standard.categories ?? 11} categories, {data?.standard.types ?? 33} service
            types with priorities and SLA timers), or add your own categories.
          </p>
          {canEdit && (
            <div className="flex items-center justify-center gap-2">
              <button type="button" onClick={installStandard} disabled={busy} className={btnPrimary}>
                <Download className="w-4 h-4" /> Load standard catalogue
              </button>
              <button type="button" onClick={() => setCategoryEdit({ id: null, name: '', description: '' })} className={btnGhost}>
                <Plus className="w-3.5 h-3.5" /> Add category
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)] gap-4 items-start">
          {/* Categories */}
          <aside className="sdg rounded-2xl border border-white/10 bg-slate-900/60 p-3 space-y-1" aria-label="Service categories">
            <div className="flex items-center justify-between px-1 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Service categories</h2>
              {canEdit && (
                <button type="button" className={btnGhost} onClick={() => setCategoryEdit({ id: null, name: '', description: '' })}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              )}
            </div>
            {!loaded && <p className="px-2.5 py-2 text-sm text-slate-500">Loading…</p>}
            {loaded && <CategoryButton label="All categories" count={totalTypes} active={selected === 'all'} onClick={() => setSelected('all')} />}
            {categories.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <CategoryButton label={c.name} count={c.types.length} active={selected === c.id} onClick={() => setSelected(c.id)} />
                {canEdit && (
                  <div className="flex shrink-0 opacity-60 group-hover:opacity-100">
                    <button type="button" className="p-1 text-slate-400 hover:text-white" aria-label={`Edit ${c.name}`}
                      onClick={() => setCategoryEdit({ id: c.id, name: c.name, description: c.description ?? '' })}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className="p-1 text-slate-400 hover:text-rose-400" aria-label={`Delete ${c.name}`}
                      onClick={() => deleteCategory(c)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </aside>

          {/* Service types */}
          <SmartDataGrid<Row>
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            loading={loading}
            kpis={kpis}
            emptyMessage={selected === 'all' ? 'No service types yet.' : 'No service types in this category yet.'}
            toolbar={{
              title: selected === 'all' ? 'All service types' : categories.find((c) => c.id === selected)?.name,
              exportName: 'fsm-service-catalog',
              actions: canEdit && categories.length > 0 ? (
                <button type="button" className={btnPrimary} onClick={() => setTypeEdit('new')}>
                  <Plus className="w-3.5 h-3.5" /> Add service type
                </button>
              ) : undefined,
            }}
          />
        </div>
      )}

      {/* Priority tiers reference */}
      <section className="sdg rounded-2xl border border-white/10 bg-slate-900/60 p-4" aria-label="Priority tiers">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Priority tiers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
          {PRIORITY_TIERS.map((p) => (
            <div key={p.tier} className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${PRIORITY_STYLE[p.priority]}`}>{p.label}</span>
              <p className="text-xs text-slate-400 mt-2">{p.definition}</p>
            </div>
          ))}
        </div>
      </section>

      {categoryEdit && (
        <CategoryDialog
          initial={categoryEdit}
          busy={busy}
          onCancel={() => setCategoryEdit(null)}
          onSave={async (v) => {
            const ok = await run(
              () => post(v.id ? { action: 'updateCategory', ...v } : { action: 'createCategory', name: v.name, description: v.description }),
              v.id ? `Updated ${v.name}.` : `Added ${v.name}.`,
            );
            if (ok) setCategoryEdit(null);
          }}
        />
      )}

      {typeEdit && (
        <TypeDialog
          initial={typeEdit === 'new' ? null : typeEdit}
          categories={categories}
          defaultCategoryId={selected !== 'all' ? selected : categories[0]?.id ?? ''}
          busy={busy}
          onCancel={() => setTypeEdit(null)}
          onSave={async (v) => {
            const ok = await run(
              () => post(typeEdit === 'new' ? { action: 'createType', ...v } : { action: 'updateType', id: typeEdit.id, ...v }),
              typeEdit === 'new' ? `Added ${v.name}.` : `Updated ${v.name}.`,
            );
            if (ok) setTypeEdit(null);
          }}
        />
      )}
    </div>
  );
}

function CategoryButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
        active ? 'bg-violet-500/15 text-violet-300 font-semibold' : 'text-slate-300 hover:bg-white/5'
      }`}>
      <span className="truncate" title={label}>{label}</span>
      <span className="shrink-0 text-[10px] tabular-nums text-slate-500">{count}</span>
    </button>
  );
}

function Dialog({ title, children, onCancel }: { title: string; children: React.ReactNode; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="sdg fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onCancel} className="p-1 text-slate-400 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide">{text}</span>
      {children}
    </label>
  );
}

function CategoryDialog({ initial, busy, onSave, onCancel }: {
  initial: { id: string | null; name: string; description: string };
  busy: boolean;
  onSave: (v: { id: string | null; name: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  return (
    <Dialog title={initial.id ? 'Edit service category' : 'Add service category'} onCancel={onCancel}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSave({ id: initial.id, name, description }); }}>
        <Label text="Category name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus /></Label>
        <Label text="Description"><input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} /></Label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function TypeDialog({ initial, categories, defaultCategoryId, busy, onSave, onCancel }: {
  initial: Row | null;
  categories: CatalogCategory[];
  defaultCategoryId: string;
  busy: boolean;
  onSave: (v: { categoryId: string; name: string; priority: TicketPriority; trigger: string; sla: CatalogSla }) => void;
  onCancel: () => void;
}) {
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaultCategoryId);
  const [name, setName] = useState(initial?.name ?? '');
  const [priority, setPriority] = useState<TicketPriority>(initial?.priority ?? 'Medium');
  const [trigger, setTrigger] = useState(initial?.trigger ?? '');
  const [response, setResponse] = useState(String(initial?.sla.responseHours ?? ''));
  const [onSite, setOnSite] = useState(String(initial?.sla.onSiteHours ?? ''));
  const [resolution, setResolution] = useState(String(initial?.sla.resolutionHours ?? ''));
  const toNum = (s: string) => (s.trim() === '' ? null : Number(s));

  return (
    <Dialog title={initial ? 'Edit service type' : 'Add service type'} onCancel={onCancel}>
      <form className="space-y-4" onSubmit={(e) => {
        e.preventDefault();
        onSave({ categoryId, name, priority, trigger, sla: { responseHours: toNum(response), onSiteHours: toNum(onSite), resolutionHours: toNum(resolution) } });
      }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Label text="Service category">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Label>
          <Label text="Priority">
            <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {PRIORITY_TIERS.map((p) => <option key={p.tier} value={p.priority}>{p.label}</option>)}
            </select>
          </Label>
        </div>
        <Label text="Service type name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus />
        </Label>
        <div className="grid grid-cols-3 gap-3">
          <Label text="Response (h)">
            <input className={inputCls} type="number" min={0.25} step={0.25} value={response} onChange={(e) => setResponse(e.target.value)} required />
          </Label>
          <Label text="On-site arrival (h)">
            <input className={inputCls} type="number" min={0.25} step={0.25} value={onSite} onChange={(e) => setOnSite(e.target.value)} required />
          </Label>
          <Label text="Resolution (h)">
            <input className={inputCls} type="number" min={0.25} step={0.25} value={resolution} onChange={(e) => setResolution(e.target.value)} required />
          </Label>
        </div>
        <p className="text-[11px] text-slate-500 -mt-2">Hours; use 0.25 for 15 minutes. Applies to new requests only.</p>
        <Label text="Trigger">
          <input className={inputCls} value={trigger} onChange={(e) => setTrigger(e.target.value)} maxLength={300}
            placeholder="e.g. Customer Support Ticket / Fault Report" />
        </Label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={btnPrimary} disabled={busy || !name.trim() || !categoryId}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Dialog>
  );
}

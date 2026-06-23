'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Field, NumberInput, Section, Select, TextInput, Toggle, type RuleTabProps } from './shared';

type CatalogItemType = 'ACCESSORY' | 'SERVICE' | 'OTHER';

interface CatalogItem {
  id: string;
  serviceTypeKey: string;
  code: string;
  itemType: CatalogItemType;
  name: string;
  description: string | null;
  unitRate: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
}

interface CatalogDraft {
  code: string;
  itemType: CatalogItemType;
  name: string;
  description: string;
  unitRate: number;
  currency: string;
  isActive: boolean;
  sortOrder: number;
}

const ITEM_TYPES: CatalogItemType[] = ['ACCESSORY', 'SERVICE', 'OTHER'];
const CURRENCIES = ['AED', 'USD', 'EUR', 'SAR'] as const;

const emptyDraft = (serviceTypeKey: string): CatalogDraft => ({
  code: '',
  itemType: serviceTypeKey === 'LEASING_QUOTATIONS' ? 'ACCESSORY' : 'SERVICE',
  name: '',
  description: '',
  unitRate: 0,
  currency: 'AED',
  isActive: true,
  sortOrder: 100,
});

function normalizeDraft(item: CatalogItem): CatalogDraft {
  return {
    code: item.code,
    itemType: item.itemType,
    name: item.name,
    description: item.description ?? '',
    unitRate: Number(item.unitRate ?? 0),
    currency: item.currency || 'AED',
    isActive: item.isActive,
    sortOrder: Number(item.sortOrder ?? 100),
  };
}

export function CatalogTab({ typeKey, typeName, linkedModule }: RuleTabProps) {
  const serviceTypeKey = typeKey || 'LEASING_QUOTATIONS';
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<CatalogDraft>(() => emptyDraft(serviceTypeKey));
  const [drafts, setDrafts] = useState<Record<string, CatalogDraft>>({});

  const isLeasing = linkedModule === 'LEASING' || serviceTypeKey.startsWith('LEASING_');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/data-masters/leasing-service-catalog?serviceTypeKey=${encodeURIComponent(serviceTypeKey)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to load catalog');
      const rows = Array.isArray(data.items) ? data.items as CatalogItem[] : [];
      setItems(rows);
      setDrafts(Object.fromEntries(rows.map(row => [row.id, normalizeDraft(row)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, [serviceTypeKey]);

  useEffect(() => {
    setNewDraft(emptyDraft(serviceTypeKey));
    void load();
  }, [load, serviceTypeKey]);

  const activeCount = useMemo(() => items.filter(item => item.isActive).length, [items]);

  const createItem = async () => {
    if (!newDraft.name.trim()) {
      setError('Name is required.');
      return;
    }
    setSavingId('new');
    setError(null);
    try {
      const res = await fetch('/api/data-masters/leasing-service-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newDraft, serviceTypeKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to create catalog item');
      setNewDraft(emptyDraft(serviceTypeKey));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create catalog item');
    } finally {
      setSavingId(null);
    }
  };

  const updateItem = async (id: string) => {
    const draft = drafts[id];
    if (!draft?.name?.trim()) {
      setError('Name is required.');
      return;
    }
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/data-masters/leasing-service-catalog/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, serviceTypeKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to update catalog item');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update catalog item');
    } finally {
      setSavingId(null);
    }
  };

  const deleteItem = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/data-masters/leasing-service-catalog/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Failed to delete catalog item');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete catalog item');
    } finally {
      setSavingId(null);
    }
  };

  const patchDraft = (id: string, patch: Partial<CatalogDraft>) => {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  if (!isLeasing) {
    return (
      <div className="rounded-xl border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-400">
        Catalog data masters are currently enabled for Vehicle Leasing service types.
      </div>
    );
  }

  if (loading) return <div className="text-sm text-slate-500">Loading catalog...</div>;

  return (
    <div className="space-y-5 max-w-5xl">
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <Section
        title={`${typeName ?? serviceTypeKey} catalog`}
        hint="Tenant-scoped accessories and service elements available in Leasing quotation Step 3."
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-slate-500">Catalog rows</div>
            <div className="text-2xl font-bold text-white">{items.length}</div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-emerald-300">Active</div>
            <div className="text-2xl font-bold text-white">{activeCount}</div>
          </div>
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-cyan-300">Accessories</div>
            <div className="text-2xl font-bold text-white">{items.filter(item => item.itemType === 'ACCESSORY').length}</div>
          </div>
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-4 py-3">
            <div className="text-xs uppercase tracking-wider text-violet-300">Services</div>
            <div className="text-2xl font-bold text-white">{items.filter(item => item.itemType === 'SERVICE').length}</div>
          </div>
        </div>
      </Section>

      <Section title="Add catalog item">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <Field label="Type">
            <Select value={newDraft.itemType} options={ITEM_TYPES} onChange={itemType => setNewDraft(prev => ({ ...prev, itemType }))} />
          </Field>
          <Field label="Code">
            <TextInput value={newDraft.code} onChange={e => setNewDraft(prev => ({ ...prev, code: e.target.value }))} placeholder="AUTO_FROM_NAME" />
          </Field>
          <Field label="Name" required>
            <TextInput value={newDraft.name} onChange={e => setNewDraft(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. GPS tracker" />
          </Field>
          <Field label="Monthly rate">
            <NumberInput value={newDraft.unitRate} min={0} onChange={unitRate => setNewDraft(prev => ({ ...prev, unitRate: unitRate ?? 0 }))} />
          </Field>
          <Field label="Currency">
            <Select value={newDraft.currency as typeof CURRENCIES[number]} options={CURRENCIES} onChange={currency => setNewDraft(prev => ({ ...prev, currency }))} />
          </Field>
          <Field label="Sort">
            <NumberInput value={newDraft.sortOrder} min={0} onChange={sortOrder => setNewDraft(prev => ({ ...prev, sortOrder: sortOrder ?? 100 }))} />
          </Field>
          <div className="md:col-span-5">
            <Field label="Description">
              <TextInput value={newDraft.description} onChange={e => setNewDraft(prev => ({ ...prev, description: e.target.value }))} placeholder="Short usage note shown to admins" />
            </Field>
          </div>
          <div className="md:col-span-1 flex items-end">
            <button
              type="button"
              onClick={createItem}
              disabled={savingId === 'new'}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-100 px-3 py-2 text-sm font-semibold text-violet-900 ring-1 ring-violet-300 hover:bg-violet-200 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </Section>

      <Section title="Catalog rows" hint="Active rows appear as quick-add preset buttons in Leasing quotation Step 3. Deactivate instead of deleting when historical quotes may reference the item.">
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
              No catalog items yet.
            </div>
          ) : (
            items.map(item => {
              const draft = drafts[item.id] ?? normalizeDraft(item);
              return (
                <div key={item.id} className="rounded-xl border border-white/10 bg-slate-950/30 p-3">
                  <div className="grid grid-cols-1 lg:grid-cols-[120px_150px_1fr_120px_110px_90px_150px] gap-3 items-start">
                    <Field label="Type">
                      <Select value={draft.itemType} options={ITEM_TYPES} onChange={itemType => patchDraft(item.id, { itemType })} />
                    </Field>
                    <Field label="Code">
                      <TextInput value={draft.code} onChange={e => patchDraft(item.id, { code: e.target.value })} />
                    </Field>
                    <Field label="Name">
                      <TextInput value={draft.name} onChange={e => patchDraft(item.id, { name: e.target.value })} />
                    </Field>
                    <Field label="Rate">
                      <NumberInput value={draft.unitRate} min={0} onChange={unitRate => patchDraft(item.id, { unitRate: unitRate ?? 0 })} />
                    </Field>
                    <Field label="Currency">
                      <Select value={draft.currency as typeof CURRENCIES[number]} options={CURRENCIES} onChange={currency => patchDraft(item.id, { currency })} />
                    </Field>
                    <Field label="Sort">
                      <NumberInput value={draft.sortOrder} min={0} onChange={sortOrder => patchDraft(item.id, { sortOrder: sortOrder ?? 100 })} />
                    </Field>
                    <div className="flex gap-2 pt-5">
                      <button
                        type="button"
                        onClick={() => updateItem(item.id)}
                        disabled={savingId === item.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-300 hover:bg-emerald-200 disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteItem(item.id)}
                        disabled={savingId === item.id}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-900 ring-1 ring-rose-300 hover:bg-rose-200 disabled:opacity-60"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Del
                      </button>
                    </div>
                    <div className="lg:col-span-6">
                      <Field label="Description">
                        <TextInput value={draft.description} onChange={e => patchDraft(item.id, { description: e.target.value })} />
                      </Field>
                    </div>
                    <div className="lg:col-span-1">
                      <Toggle label="Active" checked={draft.isActive} onChange={isActive => patchDraft(item.id, { isActive })} />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Section>
    </div>
  );
}

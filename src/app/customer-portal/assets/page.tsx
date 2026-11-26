'use client';

/** Customer Portal — the company's equipment by site and spare-parts inventory (Smart Data Grids). */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Package, Plus, X } from 'lucide-react';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';

interface Site { id: string; name: string }
interface Asset { id: string; assetNo: string; name: string; description: string | null; serialNumber: string | null; tagId: string | null; customerSiteId: string | null; manufacturer: string | null; model: string | null }
interface Item { id: string; itemNo: string; name: string; description: string | null; customerSiteId: string | null; quantity: number; reorderAt: number; unit: string | null }

export default function CustomerPortalAssets() {
  const [data, setData] = useState<{ sites: Site[]; assets: Asset[]; inventory: Item[]; canEdit: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'EQUIPMENT' | 'INVENTORY'>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/customer-portal/fsm/assets', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok) setData(d); else setErr(d?.error ?? 'Could not load your assets');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const siteName = useCallback((id: string | null) => data?.sites.find((s) => s.id === id)?.name ?? '—', [data]);

  const assetCols = useMemo<SmartDataGridColumn<Asset>[]>(() => [
    { key: 'no', header: 'Asset ID', accessor: (a) => a.assetNo, render: (a) => <span className="font-mono text-[11px]">{a.assetNo}</span> },
    { key: 'name', header: 'Name', accessor: (a) => a.name, render: (a) => <span className="text-xs font-semibold">{a.name}</span> },
    { key: 'site', header: 'Site', filter: 'select', accessor: (a) => siteName(a.customerSiteId) },
    { key: 'serial', header: 'S.No / Tag ID', accessor: (a) => [a.serialNumber, a.tagId].filter(Boolean).join(' / ') || '—' },
    { key: 'make', header: 'Make / model', accessor: (a) => [a.manufacturer, a.model].filter(Boolean).join(' ') || '—' },
    { key: 'desc', header: 'Description', accessor: (a) => a.description ?? '' },
  ], [siteName]);

  const itemCols = useMemo<SmartDataGridColumn<Item>[]>(() => [
    { key: 'no', header: 'Item ID', accessor: (i) => i.itemNo, render: (i) => <span className="font-mono text-[11px]">{i.itemNo}</span> },
    { key: 'name', header: 'Item', accessor: (i) => i.name, render: (i) => <span className="text-xs font-semibold">{i.name}</span> },
    { key: 'site', header: 'Site / store', filter: 'select', accessor: (i) => siteName(i.customerSiteId) },
    { key: 'qty', header: 'In stock', align: 'right', filter: false, accessor: (i) => i.quantity, render: (i) => <span className="tabular-nums text-xs">{i.quantity} {i.unit ?? ''}</span> },
    {
      key: 'state', header: 'Status', filter: 'select', accessor: (i) => (i.quantity <= i.reorderAt ? 'Reorder' : 'OK'),
      render: (i) => <span className={`text-xs font-semibold ${i.quantity <= i.reorderAt ? 'text-amber-600' : 'text-emerald-600'}`}>{i.quantity <= i.reorderAt ? 'Reorder' : 'OK'}</span>,
    },
  ], [siteName]);

  return (
    <div className="space-y-5">
      {err && <FormAlert>{err}</FormAlert>}
      <SmartDataGrid<Asset>
        rows={data?.assets ?? []} columns={assetCols} getRowId={(a) => a.id} loading={!data}
        emptyMessage="No equipment registered yet."
        toolbar={{ title: 'Equipment by site', exportName: 'equipment',
          actions: data?.canEdit ? <PrimaryButton icon={Plus} onClick={() => setAdding('EQUIPMENT')}>Add asset</PrimaryButton> : undefined }}
      />
      <SmartDataGrid<Item>
        rows={data?.inventory ?? []} columns={itemCols} getRowId={(i) => i.id} loading={!data}
        emptyMessage="No spare parts recorded yet."
        toolbar={{ title: 'Spare parts inventory', exportName: 'inventory',
          actions: data?.canEdit ? <PrimaryButton icon={Plus} onClick={() => setAdding('INVENTORY')}>Add item</PrimaryButton> : undefined }}
      />
      {!data?.canEdit && data && <p className="text-[11px] text-[var(--text-muted)]">Only your company admin can add equipment and inventory.</p>}
      {adding && data && (
        <AddDialog kind={adding} sites={data.sites} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); void load(); }} />
      )}
    </div>
  );
}

function AddDialog({ kind, sites, onClose, onSaved }: { kind: 'EQUIPMENT' | 'INVENTORY'; sites: Site[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ name: '', customerSiteId: sites[0]?.id ?? '', quantity: '0', reorderAt: '0', unit: 'UNIT' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setErr(null);
    if (!f.name.trim()) { setErr('Name is required.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/customer-portal/fsm/assets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, kind, quantity: Number(f.quantity), reorderAt: Number(f.reorderAt) }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not save'); return; }
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl">
        <FormPanel title={kind === 'EQUIPMENT' ? 'Add asset / equipment' : 'Add inventory item'} icon={kind === 'EQUIPMENT' ? Package : Boxes}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          <FormSection title={kind === 'EQUIPMENT' ? 'Equipment' : 'Item'} columns={2}>
            <FormField label="Name" required span="full"><TextInput value={f.name} onChange={set('name')} autoFocus /></FormField>
            <FormField label="Entity / site">
              <SelectInput value={f.customerSiteId} onChange={set('customerSiteId')}>
                <option value="">— None —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </SelectInput>
            </FormField>
            {kind === 'EQUIPMENT' ? (
              <>
                <FormField label="Serial number"><TextInput value={f.serialNumber ?? ''} onChange={set('serialNumber')} /></FormField>
                <FormField label="Tag ID"><TextInput value={f.tagId ?? ''} onChange={set('tagId')} /></FormField>
                <FormField label="Manufacturer"><TextInput value={f.manufacturer ?? ''} onChange={set('manufacturer')} /></FormField>
                <FormField label="Model"><TextInput value={f.model ?? ''} onChange={set('model')} /></FormField>
              </>
            ) : (
              <>
                <FormField label="Quantity in stock"><TextInput type="number" min={0} value={f.quantity} onChange={set('quantity')} /></FormField>
                <FormField label="Reorder at"><TextInput type="number" min={0} value={f.reorderAt} onChange={set('reorderAt')} /></FormField>
                <FormField label="Unit"><TextInput value={f.unit} onChange={set('unit')} /></FormField>
              </>
            )}
            <FormField label="Description" span="full"><TextInput value={f.description ?? ''} onChange={set('description')} /></FormField>
          </FormSection>
          <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
            <PrimaryButton icon={Plus} busy={busy} onClick={() => void save()}>Save</PrimaryButton>
          </FormFooter>
        </FormPanel>
      </div>
    </div>
  );
}

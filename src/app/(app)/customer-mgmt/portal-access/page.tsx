'use client';

/**
 * Customer Management → Customer Portal access.
 *
 * Onboarding: choose which portals each customer gets (Field Services,
 * Transport Services), and for Transport which categories (Rent-a-Car,
 * Logistics, …). Then invite the customer's users with a role in each
 * portal. One account per person: giving an existing user another portal
 * keeps their password. A new user gets a single-use setup link (7 days).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Users, Mail, Copy, X, UserPlus, Check, Truck, Save, Wrench, Search } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import SmartDataGrid, { type SmartDataGridColumn } from '@/components/ui/SmartDataGrid';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, TextInput, SelectInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';
import {
  PORTAL_LABEL, PORTAL_ROLES, ROLE_LABEL, TRANSPORT_CATEGORIES, categoryLabel,
  type CustomerPortal, type PortalRole, type TransportCategoryCode,
} from '@/lib/customer-portal/catalog';
import type { FsmPortalTypeOption } from '@/lib/customer-portal/fsm-types';

interface CustomerRow {
  customerId: string; code: string | null; name: string; status: string | null;
  portals: CustomerPortal[]; transportCategories: TransportCategoryCode[];
  fsmRequestTypes: string[];
  activeUsers: number; invitedUsers: number;
  rentalCustomer: { id: string; name: string } | null;
}
interface PortalAccount {
  id: string; email: string; fullName: string | null; mobile: string | null; isActive: boolean; hasPassword: boolean;
  lastLoginAt: string | null; roles: Partial<Record<CustomerPortal, PortalRole>>;
}

const ROLE_HELP = 'Admin: requests plus the company\'s sites, assets and users · Requester: raise and track requests · Finance: agreements and invoices, no requests · Viewer: track only';
const PORTALS: CustomerPortal[] = ['FSM', 'TRANSPORT'];

interface SendResult { ok?: boolean; error?: string; setupUrl?: string | null; expiresAt?: string; user?: { email: string } }

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: SendResult | null }> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  return { ok: res.ok && !!data?.ok, data };
}

export default function CustomerPortalAccessPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [managing, setManaging] = useState<CustomerRow | null>(null);
  const [pickingCategories, setPickingCategories] = useState<CustomerRow | null>(null);
  const [pickingFsmTypes, setPickingFsmTypes] = useState<CustomerRow | null>(null);
  const [offered, setOffered] = useState<TransportCategoryCode[]>([]);
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [availableFsmTypes, setAvailableFsmTypes] = useState<FsmPortalTypeOption[]>([]);
  const [enabledPortals, setEnabledPortals] = useState<CustomerPortal[]>(PORTALS);
  const [linkingRental, setLinkingRental] = useState<CustomerRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/customers/portal-access', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) { setErr(d?.error ?? 'Could not load customers'); return; }
    setRows(d.customers); setCanEdit(!!d.canEdit); setOffered(d.offeredCategories ?? []); setCategoryLabels(d.categoryLabels ?? {});
    setAvailableFsmTypes(Array.isArray(d.availableFsmTypes) ? d.availableFsmTypes : []);
    if (Array.isArray(d.enabledPortals)) setEnabledPortals(d.enabledPortals);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (c: CustomerRow, portal: CustomerPortal) => {
    setErr(null);
    const enabled = !c.portals.includes(portal);
    // Turning Transport on starts with choosing its categories.
    if (portal === 'TRANSPORT' && enabled) { setPickingCategories(c); return; }
    if (portal === 'TRANSPORT' && !window.confirm(`Turn off Transport Services for ${c.name}? Their users lose Transport access, including the Shipper portal.`)) return;
    const r = await send('/api/customers/portal-access', 'PUT', { customerId: c.customerId, portal, enabled });
    if (!r.ok) { setErr(r.data?.error ?? 'Could not update portal access'); return; }
    void load();
  }, [load]);

  const showFsmCol = useMemo(
    () => enabledPortals.includes('FSM') || (rows ?? []).some((r) => r.portals.includes('FSM')),
    [enabledPortals, rows],
  );
  const showTransportCol = useMemo(
    () => enabledPortals.includes('TRANSPORT') || (rows ?? []).some((r) => r.portals.includes('TRANSPORT')),
    [enabledPortals, rows],
  );

  const fsmLabelByKey = useMemo(
    () => Object.fromEntries(availableFsmTypes.map((t) => [t.key, t.name])),
    [availableFsmTypes],
  );

  const columns = useMemo<SmartDataGridColumn<CustomerRow>[]>(() => {
    const cols: SmartDataGridColumn<CustomerRow>[] = [
      { key: 'code', header: 'Customer ID', accessor: (c) => c.code ?? '', render: (c) => <span className="font-mono text-[11px]">{c.code ?? '—'}</span> },
      { key: 'name', header: 'Customer', accessor: (c) => c.name, render: (c) => <span className="text-xs font-semibold">{c.name}</span> },
    ];
    if (showFsmCol) {
      const fsmAllowed = enabledPortals.includes('FSM');
      cols.push({
        key: 'FSM', header: PORTAL_LABEL.FSM, filter: 'select',
        accessor: (c) => (c.portals.includes('FSM') ? 'Enabled' : 'Off'),
        render: (c) => {
          const on = c.portals.includes('FSM');
          const scoped = c.fsmRequestTypes ?? [];
          return (
            <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={on} disabled={!canEdit || (!fsmAllowed && !on)} onChange={() => void toggle(c, 'FSM')}
                  aria-label={`${PORTAL_LABEL.FSM} for ${c.name}`} className="rounded border-[var(--border-subtle)] text-violet-600 focus:ring-0" />
                {on ? '' : 'Off'}
              </label>
              {!fsmAllowed && on && <span className="text-[10px] font-semibold text-amber-600">Disabled in Admin</span>}
              {on && (scoped.length === 0 ? (
                <span className="px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                  All types{availableFsmTypes.length ? ` (${availableFsmTypes.length})` : ''}
                </span>
              ) : (
                <>
                  {scoped.slice(0, 2).map((k) => (
                    <span key={k} className="px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-[10px] font-semibold text-violet-700 dark:text-violet-300 max-w-[140px] truncate" title={fsmLabelByKey[k] ?? k}>
                      {fsmLabelByKey[k] ?? k}
                    </span>
                  ))}
                  {scoped.length > 2 && (
                    <span className="px-1.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                      +{scoped.length - 2} more
                    </span>
                  )}
                </>
              ))}
              {on && canEdit && fsmAllowed && (
                <button
                  type="button"
                  onClick={() => setPickingFsmTypes(c)}
                  className="text-[10px] font-semibold text-violet-600 dark:text-violet-300 hover:underline"
                >
                  Edit
                </button>
              )}
            </div>
          );
        },
      });
    }
    if (showTransportCol) {
      const transportAllowed = enabledPortals.includes('TRANSPORT');
      cols.push({
        key: 'TRANSPORT', header: PORTAL_LABEL.TRANSPORT, filter: 'select',
        accessor: (c) => (c.portals.includes('TRANSPORT') ? 'Enabled' : 'Off'),
        render: (c) => {
          const on = c.portals.includes('TRANSPORT');
          return (
            <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={on} disabled={!canEdit || (!transportAllowed && !on)} onChange={() => void toggle(c, 'TRANSPORT')}
                  aria-label={`${PORTAL_LABEL.TRANSPORT} for ${c.name}`} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
                {on ? '' : 'Off'}
              </label>
              {!transportAllowed && on && <span className="text-[10px] font-semibold text-amber-600">Disabled in Admin</span>}
              {on && (c.transportCategories.length
                ? c.transportCategories.map((k) => (
                    <span key={k} className="px-1.5 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-[10px] font-semibold text-blue-600">{categoryLabel(k, categoryLabels)}</span>
                  ))
                : <span className="text-[10px] font-semibold text-amber-600">No categories</span>)}
              {on && canEdit && transportAllowed && (
                <button type="button" onClick={() => setPickingCategories(c)} className="text-[10px] font-semibold text-blue-600 hover:underline">Edit</button>
              )}
              {on && transportAllowed && c.transportCategories.includes('RAC') && (
                <button type="button" disabled={!canEdit} onClick={() => setLinkingRental(c)}
                  className={`basis-full text-left text-[10px] font-semibold ${c.rentalCustomer ? 'text-[var(--text-muted)]' : 'text-amber-600'} ${canEdit ? 'hover:underline' : ''}`}>
                  {c.rentalCustomer ? `Rental customer: ${c.rentalCustomer.name}` : 'Link rental customer'}
                </button>
              )}
            </div>
          );
        },
      });
    }
    cols.push(
      { key: 'users', header: 'Portal users', align: 'center', filter: false, accessor: (c) => c.activeUsers, render: (c) => <span className="text-xs">{c.activeUsers} active{c.invitedUsers ? ` · ${c.invitedUsers} invited` : ''}</span> },
      {
        key: 'actions', header: '', filter: false, sortable: false,
        render: (c) => <SecondaryButton icon={Users} onClick={(e) => { e.stopPropagation(); setManaging(c); }}>Manage users</SecondaryButton>,
      },
    );
    return cols;
  }, [availableFsmTypes.length, canEdit, categoryLabels, enabledPortals, fsmLabelByKey, showFsmCol, showTransportCol, toggle]);

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader title="Customer Portal access" icon={KeyRound} accent="blue"
        subtitle="Choose the portals, Field Service request types, and Transport categories each customer gets, and invite their users. Customers sign in at /customer-portal." />
      {err && <FormAlert>{err}</FormAlert>}
      {rows && enabledPortals.length === 0 && (
        <FormAlert tone="warning">
          Neither Field Services nor Transport Services Customer Portal is currently provisioned for this tenant. Enable them in{' '}
          <Link href="/admin/tenants" className="underline font-semibold">Admin → Tenants → Modules</Link>.
        </FormAlert>
      )}
      {rows && enabledPortals.length === 1 && (
        <FormAlert tone="info">
          This tenant is provisioned for <strong>{PORTAL_LABEL[enabledPortals[0]]}</strong> only. Platform admins can enable both portals in{' '}
          <Link href="/admin/tenants" className="underline font-semibold">Admin → Tenants → Modules</Link>.
        </FormAlert>
      )}
      {!canEdit && rows && <FormAlert tone="info">View only. A tenant admin can change portal access and invite users.</FormAlert>}
      <SmartDataGrid<CustomerRow>
        rows={rows ?? []} columns={columns} getRowId={(c) => c.customerId} loading={!rows}
        emptyMessage="No customers yet. Add customers in Customer Management first."
        toolbar={{ title: 'Customers', exportName: 'customer-portal-access' }}
      />
      {managing && <UsersPanel customer={managing} enabledPortals={enabledPortals} canEdit={canEdit} onClose={() => { setManaging(null); void load(); }} />}
      {linkingRental && (
        <RentalLinkDialog customer={linkingRental} onClose={() => setLinkingRental(null)}
          onSaved={() => { setLinkingRental(null); void load(); }} />
      )}
      {pickingCategories && (
        <CategoriesDialog customer={pickingCategories} offered={offered} categoryLabels={categoryLabels} onClose={() => setPickingCategories(null)}
          onSaved={() => { setPickingCategories(null); void load(); }} />
      )}
      {pickingFsmTypes && (
        <FsmTypesDialog
          customer={pickingFsmTypes}
          availableTypes={availableFsmTypes}
          onClose={() => setPickingFsmTypes(null)}
          onSaved={() => { setPickingFsmTypes(null); void load(); }}
        />
      )}
    </div>
  );
}

function FsmTypesDialog({
  customer,
  availableTypes,
  onClose,
  onSaved,
}: {
  customer: CustomerRow;
  availableTypes: FsmPortalTypeOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialScoped = customer.fsmRequestTypes ?? [];
  const [mode, setMode] = useState<'all' | 'selected'>(initialScoped.length > 0 ? 'selected' : 'all');
  const [picked, setPicked] = useState<string[]>(initialScoped);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, FsmPortalTypeOption[]>();
    for (const t of availableTypes) {
      if (
        q &&
        !t.name.toLowerCase().includes(q) &&
        !t.categoryName.toLowerCase().includes(q) &&
        !t.key.toLowerCase().includes(q)
      ) {
        continue;
      }
      const cat = t.categoryName || 'Field Service';
      const list = map.get(cat) ?? [];
      list.push(t);
      map.set(cat, list);
    }
    return [...map.entries()];
  }, [availableTypes, search]);

  const availableKeySet = useMemo(() => new Set(availableTypes.map((t) => t.key)), [availableTypes]);
  const legacyRemoved = useMemo(
    () => picked.filter((k) => !availableKeySet.has(k)),
    [picked, availableKeySet],
  );

  const flip = (key: string) =>
    setPicked((prev) => (prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]));

  const toggleGroup = (keys: string[]) => {
    setPicked((prev) => {
      const allOn = keys.every((k) => prev.includes(k));
      if (allOn) return prev.filter((k) => !keys.includes(k));
      return [...new Set([...prev, ...keys])];
    });
  };

  const save = async () => {
    if (mode === 'selected' && picked.length === 0) {
      setErr('Select at least one Field Service request type, or switch to "All enabled types".');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await send('/api/customers/portal-access', 'PUT', {
        customerId: customer.customerId,
        portal: 'FSM',
        enabled: true,
        fsmTypes: mode === 'all' ? [] : picked,
      });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not save Field Service request types'); return; }
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Field Service request types for ${customer.name}`}
    >
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <FormPanel
          title={`Field Services — ${customer.name}`}
          subtitle="Choose whether this customer can raise all enabled FSM request types or only a specific subset."
          icon={Wrench}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}
        >
          {err && <FormAlert>{err}</FormAlert>}

          {availableTypes.length === 0 && (
            <FormAlert tone="warning">
              No Field Service catalogue request types are enabled for Customer Portal yet. Load or enable them in{' '}
              <Link href="/service-tickets/catalog" className="underline font-semibold">
                Field Service Management → Service Catalog &amp; SLA
              </Link>
              .
            </FormAlert>
          )}

          {/* Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label
              className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors ${
                mode === 'all'
                  ? 'border-emerald-500/50 bg-emerald-500/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              <input
                type="radio"
                name="fsm-scope-mode"
                checked={mode === 'all'}
                onChange={() => { setMode('all'); setErr(null); }}
                className="mt-0.5 accent-emerald-600"
              />
              <div>
                <p className="text-xs font-bold">All enabled FSM types ({availableTypes.length})</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Customer automatically sees every enabled request type from your Service Catalog &amp; SLA.
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors ${
                mode === 'selected'
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
              }`}
            >
              <input
                type="radio"
                name="fsm-scope-mode"
                checked={mode === 'selected'}
                onChange={() => {
                  setMode('selected');
                  if (picked.length === 0 && availableTypes.length > 0) {
                    setPicked(availableTypes.map((t) => t.key));
                  }
                  setErr(null);
                }}
                className="mt-0.5 accent-violet-600"
              />
              <div>
                <p className="text-xs font-bold">Specific request types only</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Restrict this customer to a chosen subset of Field Service request types.
                </p>
              </div>
            </label>
          </div>

          {mode === 'selected' && availableTypes.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <TextInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter request types or categories…"
                    className="!pl-8 !py-1.5 !text-xs"
                  />
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-semibold text-violet-700 dark:text-violet-300">
                    {picked.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => setPicked(availableTypes.map((t) => t.key))}
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setPicked([])}
                    className="font-semibold text-[var(--text-muted)] hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                {grouped.map(([catName, items]) => {
                  const catKeys = items.map((i) => i.key);
                  const allChecked = catKeys.every((k) => picked.includes(k));
                  return (
                    <div key={catName} className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                          {catName} ({items.filter((i) => picked.includes(i.key)).length}/{items.length})
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleGroup(catKeys)}
                          className="text-[10px] font-semibold text-violet-600 dark:text-violet-300 hover:underline"
                        >
                          {allChecked ? 'Clear group' : 'Select group'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {items.map((t) => (
                          <label
                            key={t.key}
                            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs cursor-pointer hover:bg-[var(--bg-surface-hover)]"
                          >
                            <input
                              type="checkbox"
                              checked={picked.includes(t.key)}
                              onChange={() => flip(t.key)}
                              className="rounded border-[var(--border-subtle)] text-violet-600 focus:ring-0"
                            />
                            <span className="truncate font-medium flex-1" title={t.name}>{t.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)] shrink-0">{t.priority}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {grouped.length === 0 && (
                  <p className="text-xs text-[var(--text-muted)] text-center py-4">No request types match &quot;{search}&quot;.</p>
                )}
              </div>

              {legacyRemoved.length > 0 && (
                <p className="text-[11px] text-amber-600">
                  {legacyRemoved.length} previously assigned type(s) are disabled or removed from the tenant catalogue ({legacyRemoved.join(', ')}).
                </p>
              )}
            </div>
          )}

          <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
            <PrimaryButton icon={Save} busy={busy} onClick={() => void save()}>Save</PrimaryButton>
          </FormFooter>
        </FormPanel>
      </div>
    </div>
  );
}

function CategoriesDialog({ customer, offered, categoryLabels, onClose, onSaved }: {
  customer: CustomerRow; offered: TransportCategoryCode[]; categoryLabels: Record<string, string>; onClose: () => void; onSaved: () => void;
}) {
  // Categories the tenant offers (built-in + custom), plus any the customer already has that are no longer offered.
  const choices = useMemo(() => {
    const seen = new Set<string>();
    const out: TransportCategoryCode[] = [];
    for (const k of [...TRANSPORT_CATEGORIES, ...offered, ...customer.transportCategories]) {
      if (seen.has(k)) continue;
      if (offered.includes(k) || customer.transportCategories.includes(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out;
  }, [offered, customer.transportCategories]);
  const [picked, setPicked] = useState<TransportCategoryCode[]>(customer.transportCategories);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const flip = (k: TransportCategoryCode) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const save = async () => {
    if (picked.length === 0) { setErr('Choose at least one category.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await send('/api/customers/portal-access', 'PUT', { customerId: customer.customerId, portal: 'TRANSPORT', enabled: true, categories: picked });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not save the categories'); return; }
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Transport categories for ${customer.name}`}>
      <div className="w-full max-w-xl">
        <FormPanel title={`Transport Services — ${customer.name}`} subtitle="The vehicle request types this customer can use" icon={Truck}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {choices.length === 0 && (
            <FormAlert tone="warning">
              Your Transport catalogue offers no categories yet. Turn them on in{' '}
              <Link href="/customer-mgmt/transport-catalog" className="underline">Transport Services catalogue</Link>.
            </FormAlert>
          )}
          <FormSection title="Categories" icon={Truck} columns={2}>
            {choices.map((k) => (
              <label key={k} className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-xs cursor-pointer hover:bg-[var(--bg-surface-hover)]">
                <input type="checkbox" checked={picked.includes(k)} onChange={() => flip(k)} className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0" />
                <span className="font-semibold">{categoryLabel(k, categoryLabels)}</span>
                {k === 'LOGISTICS' && <span className="text-[10px] text-[var(--text-muted)]">Shipper portal</span>}
                {!offered.includes(k) && <span className="text-[10px] font-semibold text-amber-600">No longer offered</span>}
              </label>
            ))}
          </FormSection>
          <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
            <PrimaryButton icon={Save} busy={busy} onClick={() => void save()}>Save</PrimaryButton>
          </FormFooter>
        </FormPanel>
      </div>
    </div>
  );
}

interface RentalOption { id: string; name: string; companyName: string | null; tradeLicense: string | null; email: string | null; linkedCustomerId: string | null }

/** Choose which Rental customer this customer is, so its rentals show in the Customer Portal. */
function RentalLinkDialog({ customer, onClose, onSaved }: { customer: CustomerRow; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState(customer.name);
  const [options, setOptions] = useState<RentalOption[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(`/api/customers/rental-links?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
      const d = await res.json().catch(() => null);
      if (res.ok && d?.ok) setOptions(d.options); else setErr(d?.error ?? 'Could not search rental customers');
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const save = async (rentalCustomerId: string | null) => {
    setBusy(true); setErr(null);
    try {
      const r = await send('/api/customers/rental-links', 'PUT', { customerId: customer.customerId, rentalCustomerId });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not save the link'); return; }
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Rental customer for ${customer.name}`}>
      <div className="w-full max-w-xl">
        <FormPanel title={`Rental customer — ${customer.name}`} subtitle="The Rental customer whose bookings, agreements and invoices this company sees in the Customer Portal" icon={Truck}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {customer.rentalCustomer && <FormAlert tone="info">Linked to {customer.rentalCustomer.name}.</FormAlert>}
          <FormField label="Search rental customers" hint="Company name, person, trade licence or email">
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </FormField>
          <div className="divide-y divide-[var(--border-subtle)] max-h-80 overflow-y-auto">
            {!options && <p className="py-2 text-[var(--text-muted)]">Searching…</p>}
            {options?.length === 0 && <p className="py-2 text-[var(--text-muted)]">No rental customers match.</p>}
            {options?.map((o) => {
              const takenElsewhere = !!o.linkedCustomerId && o.linkedCustomerId !== customer.customerId;
              const current = o.linkedCustomerId === customer.customerId;
              return (
                <div key={o.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{o.companyName ?? o.name}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{[o.companyName ? o.name : null, o.tradeLicense, o.email].filter(Boolean).join(' · ') || '—'}</p>
                  </div>
                  {current ? <span className="text-[11px] font-semibold text-emerald-600">Linked</span>
                    : takenElsewhere ? <span className="text-[11px] text-[var(--text-muted)]">Linked to another customer</span>
                    : <PrimaryButton busy={busy} onClick={() => void save(o.id)}>Link</PrimaryButton>}
                </div>
              );
            })}
          </div>
          {customer.rentalCustomer && (
            <FormFooter><SecondaryButton disabled={busy} onClick={() => void save(null)}>Remove link</SecondaryButton></FormFooter>
          )}
        </FormPanel>
      </div>
    </div>
  );
}

function RoleSelect({ value, onChange, disabled, label }: { value: PortalRole | null; onChange: (v: PortalRole | null) => void; disabled?: boolean; label: string }) {
  return (
    <SelectInput value={value ?? ''} disabled={disabled} aria-label={label} className="!w-32"
      onChange={(e) => onChange((e.target.value || null) as PortalRole | null)}>
      <option value="">No access</option>
      {PORTAL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </SelectInput>
  );
}

function UsersPanel({ customer, enabledPortals, canEdit, onClose }: { customer: CustomerRow; enabledPortals: CustomerPortal[]; canEdit: boolean; onClose: () => void }) {
  const activeCustomerPortals = customer.portals.filter((p) => enabledPortals.includes(p));
  const initialRoles = (): Partial<Record<CustomerPortal, PortalRole | null>> =>
    Object.fromEntries(activeCustomerPortals.map((p) => [p, 'REQUESTER']));
  const [users, setUsers] = useState<PortalAccount[] | null>(null);
  const [form, setForm] = useState({ email: '', fullName: '', mobile: '' });
  const [roles, setRoles] = useState(initialRoles);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; email: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/customers/portal-users?customerId=${encodeURIComponent(customer.customerId)}`, { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (res.ok && d?.ok) setUsers(d.users); else setErr(d?.error ?? 'Could not load users');
  }, [customer.customerId]);
  useEffect(() => { void load(); }, [load]);

  const invite = async (email: string, fullName: string, mobile: string, portalRoles: Partial<Record<CustomerPortal, PortalRole | null>>) => {
    setErr(null); setLink(null); setNotice(null); setCopied(false);
    const granted = Object.fromEntries(Object.entries(portalRoles).filter(([, r]) => r));
    if (Object.keys(granted).length === 0) { setErr('Choose a role in at least one portal.'); return; }
    setBusy(true);
    try {
      const r = await send('/api/customers/portal-users', 'POST', { customerId: customer.customerId, email, fullName, mobile, roles: granted });
      if (!r.ok) { setErr(r.data?.error ?? 'Could not invite the user'); return; }
      const who = r.data?.user?.email ?? '';
      if (r.data?.setupUrl) setLink({ url: r.data.setupUrl, email: who, expiresAt: r.data.expiresAt ?? '' });
      else setNotice(`Access updated. ${who} already has a password and can sign in with it.`);
      setForm({ email: '', fullName: '', mobile: '' }); setRoles(initialRoles());
      void load();
    } finally { setBusy(false); }
  };

  const update = async (u: PortalAccount, patch: { isActive?: boolean; roles?: Partial<Record<CustomerPortal, PortalRole | null>> }) => {
    setErr(null); setNotice(null);
    const r = await send('/api/customers/portal-users', 'PATCH', { id: u.id, ...patch });
    if (!r.ok) { setErr(r.data?.error ?? 'Could not update the user'); return; }
    void load();
  };

  // Show a portal's role picker when the tenant + customer have it, or the user still holds a legacy role there.
  const portalsFor = (u?: PortalAccount) => PORTALS.filter((p) => activeCustomerPortals.includes(p) || !!u?.roles[p]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label={`Portal users for ${customer.name}`}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-[var(--bg-main)] p-4 space-y-4">
        <FormPanel title={`Portal users — ${customer.name}`}
          subtitle={`Customer ID ${customer.code ?? '—'} · ${customer.portals.length ? customer.portals.map((p) => PORTAL_LABEL[p]).join(', ') : 'No portal enabled yet'}`}
          icon={Users} actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {err && <FormAlert>{err}</FormAlert>}
          {notice && <FormAlert tone="info">{notice}</FormAlert>}
          {customer.portals.length === 0 && <FormAlert tone="warning">Enable at least one portal for this customer, or invited users will not be able to sign in.</FormAlert>}
          {link && (
            <FormAlert tone="info">
              <span className="block font-semibold">Invite ready for {link.email}</span>
              <span className="block">Send this link to the user. It works once and expires {new Date(link.expiresAt).toLocaleDateString()}.</span>
              <span className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-[var(--bg-main)] px-2 py-1 text-[11px]">{link.url}</code>
                <SecondaryButton icon={copied ? Check : Copy} onClick={() => { void navigator.clipboard.writeText(link.url); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</SecondaryButton>
              </span>
            </FormAlert>
          )}

          <FormSection title="Users" icon={Users} columns={1}>
            {!users && <p className="text-[var(--text-muted)]">Loading…</p>}
            {users?.length === 0 && <p className="text-[var(--text-muted)]">No portal users yet.</p>}
            <div className="divide-y divide-[var(--border-subtle)]">
              {users?.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{u.fullName ?? u.email}{!u.isActive && <span className="text-rose-500"> · deactivated</span>}</p>
                    <p className="text-[11px] text-[var(--text-muted)]">{u.email} · {u.hasPassword ? (u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toLocaleDateString()}` : 'never signed in') : 'invite pending'}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {portalsFor(u).map((p) => (
                      <label key={p} className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]">
                        {p === 'FSM' ? 'Field' : 'Transport'}
                        <RoleSelect value={u.roles[p] ?? null} disabled={!canEdit} label={`${PORTAL_LABEL[p]} role for ${u.email}`}
                          onChange={(v) => void update(u, { roles: { [p]: v } })} />
                      </label>
                    ))}
                    {canEdit && !u.hasPassword && u.isActive && (
                      <SecondaryButton icon={Mail} onClick={() => void invite(u.email, u.fullName ?? '', u.mobile ?? '', u.roles)}>New link</SecondaryButton>
                    )}
                    {canEdit && (
                      <SecondaryButton onClick={() => void update(u, { isActive: !u.isActive })}>{u.isActive ? 'Deactivate' : 'Reactivate'}</SecondaryButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </FormSection>

          {canEdit && (
            <form onSubmit={(e) => { e.preventDefault(); void invite(form.email, form.fullName, form.mobile, roles); }}>
              <FormSection title="Invite a user" icon={UserPlus} columns={2}>
                <FormField label="Email" required><TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@company.com" required /></FormField>
                <FormField label="Full name"><TextInput value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></FormField>
                <FormField label="Mobile"><TextInput value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+971 5x xxx xxxx" /></FormField>
                {portalsFor().map((p) => (
                  <FormField key={p} label={`${PORTAL_LABEL[p]} role`} hint={ROLE_HELP}>
                    <RoleSelect value={roles[p] ?? null} label={`${PORTAL_LABEL[p]} role`} onChange={(v) => setRoles({ ...roles, [p]: v })} />
                  </FormField>
                ))}
              </FormSection>
              <p className="mt-2 text-[11px] text-[var(--text-muted)]">If this email already has an account for {customer.name}, it keeps its password and gets the roles chosen here.</p>
              <div className="mt-3">
                <FormFooter><PrimaryButton type="submit" icon={UserPlus} busy={busy}>{busy ? 'Inviting…' : 'Invite user'}</PrimaryButton></FormFooter>
              </div>
            </form>
          )}
        </FormPanel>
      </div>
    </div>
  );
}

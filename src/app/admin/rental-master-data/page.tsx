'use client';

import { PageHeader, Panel } from '@/components/ui/page-theme';
import { getClientMe, type ClientMeResponse } from '@/lib/client-session';
import {
  DEFAULT_RENTAL_MASTER_DATA,
  type RentalAncillaryPreset,
  type RentalEmirate,
  type RentalMasterCatalog,
  type RentalMasterOption,
  type RentalRateEventPreset,
} from '@/lib/rental-master-data';
import {
  CarFront,
  Building2,
  CalendarRange,
  Coins,
  Globe2,
  Save,
  ShieldCheck,
  Tags,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ScopeMode = 'tenant' | 'platform';
type MessageTone = 'success' | 'error' | 'info';

interface MasterDataResponse {
  scope: ScopeMode;
  tenantId?: string;
  catalog: RentalMasterCatalog;
  overrides?: Partial<RentalMasterCatalog>;
}

function cloneCatalog(catalog: RentalMasterCatalog): RentalMasterCatalog {
  return JSON.parse(JSON.stringify(catalog)) as RentalMasterCatalog;
}

function MessageBanner({ tone, message }: { tone: MessageTone; message: string }) {
  const cls =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : tone === 'error'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200';
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{message}</div>;
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function TextListEditor({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle title={label} hint={hint} />
      <textarea
        value={values.join('\n')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/\r?\n/)
              .map((entry) => entry.trim())
              .filter(Boolean),
          )
        }
        rows={Math.max(5, values.length + 1)}
        className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-violet-500 focus:outline-none"
      />
      <p className="text-[11px] text-slate-500">One value per line.</p>
    </div>
  );
}

function SimpleTableEditor<T extends object>({
  title,
  hint,
  rows,
  columns,
  onChange,
  createRow,
}: {
  title: string;
  hint: string;
  rows: T[];
  columns: { key: keyof T; label: string; type?: 'text' | 'number' | 'select'; options?: string[] }[];
  onChange: (next: T[]) => void;
  createRow: () => T;
}) {
  const updateCell = (index: number, key: keyof T, value: string) => {
    const next = rows.map((row, rowIndex) =>
      rowIndex === index
        ? {
            ...row,
            [key]: columns.find((col) => col.key === key)?.type === 'number' ? Number(value || 0) : value,
          }
        : row,
    );
    onChange(next);
  };

  const removeRow = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));
  const addRow = () => onChange([...rows, createRow()]);

  return (
    <div className="space-y-3">
      <SectionTitle title={title} hint={hint} />
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-900/70">
            <tr>
              {columns.map((column) => (
                <th key={String(column.key)} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
                  {column.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${index}-${Object.values(row).join('-')}`} className="border-t border-white/5">
                {columns.map((column) => (
                  <td key={String(column.key)} className="px-3 py-2">
                    {column.type === 'select' ? (
                      <select
                        value={String(row[column.key] ?? '')}
                        onChange={(e) => updateCell(index, column.key, e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white focus:border-violet-500 focus:outline-none"
                      >
                        {column.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={column.type === 'number' ? 'number' : 'text'}
                        value={String(row[column.key] ?? '')}
                        onChange={(e) => updateCell(index, column.key, e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-white focus:border-violet-500 focus:outline-none"
                      />
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/20"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
      >
        + Add row
      </button>
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{sub}</p>
    </div>
  );
}

export default function RentalMasterDataAdminPage() {
  const [me, setMe] = useState<ClientMeResponse | null>(null);
  const [scope, setScope] = useState<ScopeMode>('tenant');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: MessageTone; text: string } | null>(null);
  const [draft, setDraft] = useState<RentalMasterCatalog>(cloneCatalog(DEFAULT_RENTAL_MASTER_DATA));

  const canEditPlatform = me?.isSuperAdmin ?? false;

  const load = useCallback(async (mode: ScopeMode) => {
    setLoading(true);
    setMessage(null);
    try {
      const meData = await getClientMe();
      setMe(meData);
      const qs = new URLSearchParams({ scope: mode });
      const res = await fetch(`/api/admin/rental/master-data?${qs.toString()}`, { cache: 'no-store' });
      const data = (await res.json()) as MasterDataResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load rental master data');
      setDraft(cloneCatalog(data.catalog));
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to load rental master data' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(scope);
  }, [load, scope]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const qs = new URLSearchParams({ scope });
      const res = await fetch(`/api/admin/rental/master-data?${qs.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = (await res.json()) as MasterDataResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to save rental master data');
      setDraft(cloneCatalog(data.catalog));
      setMessage({
        tone: 'success',
        text: scope === 'platform'
          ? 'Platform RAC master data updated successfully.'
          : 'Tenant RAC master-data overrides updated successfully.',
      });
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save rental master data' });
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(
    () => ({
      vehicleCategories: draft.vehicleCategories.length,
      bookingChannels: draft.bookingChannels.length,
      ancillaryPresets: draft.ancillaryPresets.length,
      ratePresets: draft.rateEventPresets.length,
    }),
    [draft],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="RAC Master Data"
        subtitle="Manage the configurable master-data lists that drive Rental workflows, pricing, insurance, staffing, and handover operations."
        icon={CarFront}
        accent="violet"
        actions={
          <div className="flex items-center gap-2">
            {canEditPlatform && (
              <div className="rounded-xl border border-white/10 bg-slate-900/70 p-1">
                {(['tenant', 'platform'] as ScopeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setScope(mode)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                      scope === mode ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {mode === 'tenant' ? 'Current Tenant' : 'Platform Defaults'}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      {message && <MessageBanner tone={message.tone} message={message.text} />}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="Vehicle Categories" value={stats.vehicleCategories} sub="Bookings, inquiries, quotations, availability" />
        <SummaryCard label="Booking Channels" value={stats.bookingChannels} sub="Bookings, rate engine, downstream reporting" />
        <SummaryCard label="Ancillary Presets" value={stats.ancillaryPresets} sub="Seed catalogue and booking add-on suggestions" />
        <SummaryCard label="Rate Event Presets" value={stats.ratePresets} sub="Seasonal pricing accelerator templates" />
      </div>

      <Panel
        title={scope === 'platform' ? 'Platform Scope' : 'Tenant Scope'}
        subtitle={
          scope === 'platform'
            ? 'These values seed default RAC master data for every tenant unless a tenant override replaces them.'
            : 'These values act as the current tenant’s RAC catalog. Updating them changes the resolved lists used by the tenant-facing RAC pages.'
        }
        icon={scope === 'platform' ? Globe2 : Building2}
        accent={scope === 'platform' ? 'amber' : 'blue'}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <ShieldCheck className="h-4 w-4 text-violet-300" />
              Governance
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Saves go through the Admin RAC master-data API, so audit/change history captures the update and the page surfaces stay aligned with the same source of truth.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Users className="h-4 w-4 text-cyan-300" />
              Consumer Surfaces
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Bookings, inquiries, quotations, availability, pricing, insurance, staff, branches, handover, rate events, and ancillary seeding now read from this catalog.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Tags className="h-4 w-4 text-emerald-300" />
              Save Discipline
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Use platform scope for standards and tenant scope for operator-specific catalogs. That keeps the multi-tenant model predictable and easier to support.
            </p>
          </div>
        </div>
      </Panel>

      {loading ? (
        <Panel title="Loading" subtitle="Fetching RAC master data..." accent="slate">
          <div className="py-10 text-center text-slate-400">Loading RAC master-data editor...</div>
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Commercial Lists" subtitle="Bookings, inquiries, quotations, and pricing pickers" icon={Coins} accent="emerald">
            <div className="space-y-6">
              <TextListEditor
                label="Vehicle categories"
                hint="Customer-facing categories used across booking, inquiry, quotation, and availability screens."
                values={draft.vehicleCategories}
                onChange={(next) => setDraft((prev) => ({ ...prev, vehicleCategories: next }))}
              />
              <TextListEditor
                label="Availability categories"
                hint="Expanded category list used by the availability screen."
                values={draft.availabilityVehicleCategories}
                onChange={(next) => setDraft((prev) => ({ ...prev, availabilityVehicleCategories: next }))}
              />
              <TextListEditor
                label="Booking channels"
                hint="Internal booking channels used by bookings and rate-engine filters."
                values={draft.bookingChannels}
                onChange={(next) => setDraft((prev) => ({ ...prev, bookingChannels: next }))}
              />
              <TextListEditor
                label="Inquiry sources"
                hint="Lead source list used by inquiries and conversion tracking."
                values={draft.inquirySources}
                onChange={(next) => setDraft((prev) => ({ ...prev, inquirySources: next }))}
              />
              <TextListEditor
                label="Customer types"
                hint="Commercial customer segments used by the rate engine."
                values={draft.customerTypes}
                onChange={(next) => setDraft((prev) => ({ ...prev, customerTypes: next }))}
              />
              <TextListEditor
                label="Currencies"
                hint="Currencies exposed in rate-engine and pricing forms."
                values={draft.currencies}
                onChange={(next) => setDraft((prev) => ({ ...prev, currencies: next }))}
              />
            </div>
          </Panel>

          <Panel title="Operations Lists" subtitle="Branches, insurance, staff, and handover catalogs" icon={Users} accent="blue">
            <div className="space-y-6">
              <TextListEditor
                label="Staff roles"
                hint="Roles available in RAC staff assignment flows."
                values={draft.staffRoles}
                onChange={(next) => setDraft((prev) => ({ ...prev, staffRoles: next }))}
              />
              <TextListEditor
                label="Staff modules"
                hint="Module-affiliation values used by RAC staff records."
                values={draft.staffModules}
                onChange={(next) => setDraft((prev) => ({ ...prev, staffModules: next }))}
              />
              <TextListEditor
                label="Insurers"
                hint="Insurance provider list used by RAC policy entry."
                values={draft.insurers}
                onChange={(next) => setDraft((prev) => ({ ...prev, insurers: next }))}
              />
              <TextListEditor
                label="Policy types"
                hint="Policy type list exposed on the insurance documentation page."
                values={draft.policyTypes}
                onChange={(next) => setDraft((prev) => ({ ...prev, policyTypes: next }))}
              />
              <TextListEditor
                label="Fuel labels"
                hint="Displayed fuel levels for pickup and return handovers."
                values={draft.fuelLabels}
                onChange={(next) => setDraft((prev) => ({ ...prev, fuelLabels: next }))}
              />
            </div>
          </Panel>

          <Panel title="Structured Catalogs" subtitle="Machine-readable code/label tables used by RAC screens" icon={Building2} accent="amber" className="xl:col-span-2">
            <div className="space-y-8">
              <SimpleTableEditor<RentalEmirate>
                title="Emirates"
                hint="Used by branches and staff assignment editors."
                rows={draft.emirates}
                columns={[
                  { key: 'key', label: 'Key' },
                  { key: 'label', label: 'Label' },
                  { key: 'flag', label: 'Flag / Marker' },
                ]}
                createRow={() => ({ key: '', label: '', flag: '' })}
                onChange={(next) => setDraft((prev) => ({ ...prev, emirates: next }))}
              />

              <SimpleTableEditor<RentalMasterOption>
                title="Rate vehicle categories"
                hint="Value/label pairs used by the RAC pricing and rate-engine screens."
                rows={draft.rateVehicleCategories}
                columns={[
                  { key: 'value', label: 'Value' },
                  { key: 'label', label: 'Label' },
                ]}
                createRow={() => ({ value: '', label: '' })}
                onChange={(next) => setDraft((prev) => ({ ...prev, rateVehicleCategories: next }))}
              />
            </div>
          </Panel>

          <Panel title="Pricing & Add-on Presets" subtitle="Reusable presets for rate events and ancillary seeding" icon={CalendarRange} accent="rose" className="xl:col-span-2">
            <div className="space-y-8">
              <SimpleTableEditor<RentalRateEventPreset>
                title="Rate event presets"
                hint="Calendar pricing templates shown in the rate-events admin page."
                rows={draft.rateEventPresets}
                columns={[
                  { key: 'eventCode', label: 'Event Code' },
                  { key: 'name', label: 'Name' },
                  { key: 'multiplier', label: 'Multiplier', type: 'number' },
                ]}
                createRow={() => ({ eventCode: '', name: '', multiplier: 1 })}
                onChange={(next) => setDraft((prev) => ({ ...prev, rateEventPresets: next }))}
              />

              <SimpleTableEditor<RentalAncillaryPreset>
                title="Ancillary presets"
                hint="Seed templates for standard add-ons in the ancillary catalogue."
                rows={draft.ancillaryPresets}
                columns={[
                  { key: 'code', label: 'Code' },
                  { key: 'nameEn', label: 'Name (EN)' },
                  { key: 'nameAr', label: 'Name (AR)' },
                  { key: 'category', label: 'Category' },
                  { key: 'pricingType', label: 'Pricing Type', type: 'select', options: ['PER_DAY', 'ONE_TIME'] },
                  { key: 'unitPrice', label: 'Unit Price', type: 'number' },
                ]}
                createRow={() => ({
                  code: '',
                  nameEn: '',
                  nameAr: '',
                  category: 'ACCESSORY',
                  pricingType: 'PER_DAY',
                  unitPrice: 0,
                })}
                onChange={(next) => setDraft((prev) => ({ ...prev, ancillaryPresets: next }))}
              />
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}

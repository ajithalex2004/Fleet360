'use client';

/**
 * New Service Request — the Field Service request form.
 *
 *  1. Request details      Request ID (FSM-SR-<customer>-YYXXXX, assigned on
 *                          submit), request channel, created date & time.
 *  2. Customer info        Customer ID & name, entity / site (add new, pin on
 *                          the map), the site's contact person & mobile.
 *  3. Service classification  Category → type, priority & SLA from the
 *                          Service Catalog & SLA master (read-only).
 *  4. Service details      Asset / equipment at the site (S.No / Tag ID, name,
 *                          description), subject, description, photos,
 *                          service needed at date & time, type-specific fields.
 *  5. Entitlement / billing  AMC, under warranty, contract, chargeable…
 *
 * `fixedCustomerId` locks the customer (the Customer Portal passes the
 * signed-in customer); staff pick the customer.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Wrench, X, ListTree, FileText, MapPin, Send, User, Package, Receipt, Plus, Camera, Trash2, Building2,
} from 'lucide-react';
import {
  FormPanel, FormSection, FormField, FormAlert, FormFooter, ReadOnlyValue, CheckboxField,
  TextInput, SelectInput, TextAreaInput, PrimaryButton, SecondaryButton,
} from '@/components/ui/form-kit';
import LocationPickerModal, { type PickedLocation } from '@/components/logistics/LocationPickerModal';
import { formatSlaHours, priorityLabel } from '@/lib/service-tickets/priority-tiers';
import type { FormFieldDef, ServiceTicket, TicketPriority, TicketType } from '@/types/service-tickets';

// ── Shapes ─────────────────────────────────────────────────────────────────

export interface RequestTypeConfig {
  name: string;
  longLabel: string;
  description: string;
  vehicleRequired: boolean;
  autoCreatesMaintenanceRequest: boolean;
  defaultPriority: TicketPriority;
  defaultSlaHours: number;
  categoryKey?: string;
  categoryName?: string;
  slaByPriority?: Record<TicketPriority, number>;
  approvalRequired: boolean;
  approvalEmergencyBypass: boolean;
  catalogSla?: { responseHours: number | null; onSiteHours: number; resolutionHours: number | null } | null;
}

export interface RequestVehicleOption {
  id: string; vehicleCode: string | null; licensePlate: string | null; make: string | null; model: string | null;
}

interface Customer { id: string; code: string; name: string; contactPerson: string | null; contactPhone: string | null }
interface Site {
  id: string; name: string; address: string | null; city: string | null;
  latitude: number | null; longitude: number | null; contactPerson: string | null; contactMobile: string | null;
}
interface Asset {
  id: string; assetNo: string; name: string; description: string | null; serialNumber: string | null;
  tagId: string | null; customerSiteId: string | null; manufacturer: string | null; model: string | null;
}
interface Option { value: string; label: string }

/** Where the form reads and writes. Defaults to the staff APIs; the Customer Portal passes its own. */
export interface RequestFormApi {
  /** Customer list + channel / entitlement options; null when the customer is fixed (portal). */
  customersUrl: string | null;
  contextUrl: (customerId: string) => string;
  createUrl: string;
  photosUrl: (ticketId: string) => string;
  addSiteUrl: (customerId: string) => string;
  addAssetUrl: (customerId: string) => string;
  canAddSite: boolean;
  canAddAsset: boolean;
  /** Used when customersUrl is null. */
  channels?: Option[];
  entitlements?: Option[];
}

export const STAFF_REQUEST_API: RequestFormApi = {
  customersUrl: '/api/service-tickets/customers',
  contextUrl: (id) => `/api/service-tickets/customers/${id}/context`,
  createUrl: '/api/service-tickets',
  photosUrl: (id) => `/api/service-tickets/${id}/attachments`,
  addSiteUrl: (id) => `/api/service-tickets/customers/${id}/sites`,
  addAssetUrl: (id) => `/api/service-tickets/customers/${id}/assets`,
  canAddSite: true,
  canAddAsset: true,
};

const fmtNow = (d: Date) =>
  d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** datetime-local value for "now + h hours", local time. */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function NewServiceRequestForm({
  enabledTypes, formFieldsByType, typeConfigByType, vehicles, fixedCustomerId, onCreated, onCancel, api = STAFF_REQUEST_API,
}: {
  enabledTypes: TicketType[];
  formFieldsByType: Partial<Record<TicketType, FormFieldDef[]>>;
  typeConfigByType: Partial<Record<TicketType, RequestTypeConfig>>;
  vehicles: RequestVehicleOption[];
  fixedCustomerId?: string;
  api?: RequestFormApi;
  onCreated: (t: ServiceTicket) => void;
  onCancel: () => void;
}) {
  // ── Reference data ──
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [channels, setChannels] = useState<Option[]>([]);
  const [entitlements, setEntitlements] = useState<Option[]>([]);
  const [now, setNow] = useState(() => new Date());

  // ── Customer context ──
  const [customerId, setCustomerId] = useState(fixedCustomerId ?? '');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [nextRequestNo, setNextRequestNo] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [addingSite, setAddingSite] = useState(false);
  const [addingAsset, setAddingAsset] = useState(false);

  // ── Request ──
  const [channel, setChannel] = useState('CUSTOMER_PORTAL');
  const [category, setCategory] = useState('');
  const [ticketType, setTicketType] = useState<TicketType>(enabledTypes[0] ?? 'MAINTENANCE');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [serviceNeededAt, setServiceNeededAt] = useState(() => localInput(new Date(Date.now() + 2 * 3600_000)));
  const [entitlement, setEntitlement] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Live clock for "Created date & time" (the server stamps the real time on submit).
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!api.customersUrl) {
      setChannels(api.channels ?? []);
      setEntitlements(api.entitlements ?? []);
      return;
    }
    void (async () => {
      const res = await fetch(api.customersUrl!);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setErr(data?.error ?? 'Could not load customers.'); return; }
      setCustomers(data.customers ?? []);
      setChannels(data.channels ?? []);
      setEntitlements(data.entitlements ?? []);
    })();
  }, [api]);

  const loadContext = async (id: string, keep?: { siteId?: string; assetId?: string }) => {
    setCustomer(null); setSites([]); setAssets([]); setNextRequestNo(null);
    if (!keep) { setSiteId(''); setAssetId(''); }
    if (!id) return;
    const res = await fetch(api.contextUrl(id));
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) { setErr(data?.error ?? 'Could not load the customer.'); return; }
    setCustomer(data.customer); setSites(data.sites ?? []); setAssets(data.assets ?? []); setNextRequestNo(data.nextRequestNo);
    if (keep?.siteId) setSiteId(keep.siteId);
    if (keep?.assetId) setAssetId(keep.assetId);
  };
  // Reload only when the customer changes (loadContext reads the stable api config and setters).
  useEffect(() => { void loadContext(customerId); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Types: category first, then a type within it ──
  const typeGroups = useMemo(() => {
    const groups = new Map<string, TicketType[]>();
    for (const t of enabledTypes) {
      const c = typeConfigByType[t];
      if (!c) continue;
      const g = c.categoryName || 'Other';
      groups.set(g, [...(groups.get(g) ?? []), t]);
    }
    const isFsm = (types: TicketType[]) => (typeConfigByType[types[0]]?.categoryKey ?? '').startsWith('FSM_');
    return [...groups.entries()].sort((a, b) => Number(isFsm(b[1])) - Number(isFsm(a[1])));
  }, [enabledTypes, typeConfigByType]);
  const categoryTypes = useMemo(() => typeGroups.find(([g]) => g === category)?.[1] ?? [], [typeGroups, category]);
  useEffect(() => {
    if (typeGroups.length && !typeGroups.some(([g]) => g === category)) setCategory(typeGroups[0][0]);
  }, [typeGroups, category]);
  useEffect(() => {
    if (categoryTypes.length && !categoryTypes.includes(ticketType)) setTicketType(categoryTypes[0]);
  }, [categoryTypes, ticketType]);
  useEffect(() => { setCustomFields({}); }, [ticketType]);

  const tc = typeConfigByType[ticketType];
  const formFields: FormFieldDef[] = useMemo(() => formFieldsByType[ticketType] ?? [], [formFieldsByType, ticketType]);
  const catalogSla = tc?.catalogSla ?? null;
  const isFsmType = !!catalogSla;
  const priority: TicketPriority = tc?.defaultPriority ?? 'Medium';
  const resolutionHours = catalogSla?.resolutionHours ?? tc?.slaByPriority?.[priority] ?? tc?.defaultSlaHours ?? null;
  const willAwaitApproval = !!tc?.approvalRequired && !(tc.approvalEmergencyBypass && (priority === 'High' || priority === 'Critical'));
  const longLabel = tc?.longLabel ?? ticketType;

  const site = sites.find((s) => s.id === siteId) ?? null;
  const siteAssets = useMemo(() => assets.filter((a) => !siteId || !a.customerSiteId || a.customerSiteId === siteId), [assets, siteId]);
  const asset = assets.find((a) => a.id === assetId) ?? null;

  // The type's "Building / site" field follows the chosen entity / site.
  useEffect(() => {
    if (site && formFields.some((f) => f.key === 'building')) {
      setCustomFields((prev) => (prev.building ? prev : { ...prev, building: site.name }));
    }
  }, [site, formFields]);

  const setField = (key: string, value: unknown) => setCustomFields((prev) => ({ ...prev, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (isFsmType && !customerId) { setErr('Select the customer.'); return; }
    if (isFsmType && !siteId) { setErr('Select the entity / site where the service is needed.'); return; }
    if (!title.trim()) { setErr('Request subject is required.'); return; }
    if (tc?.vehicleRequired && !vehicleId) { setErr(`${longLabel} requires a vehicle.`); return; }
    for (const f of formFields) {
      if (!f.required) continue;
      const v = customFields[f.key];
      if ((v === undefined || v === null || v === '' || v === false) && f.type !== 'checkbox') {
        setErr(`${f.label} is required for ${longLabel}.`); return;
      }
    }

    setSubmitting(true);
    try {
      const neededAt = serviceNeededAt ? new Date(serviceNeededAt).toISOString() : undefined;
      const res = await fetch(api.createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketType,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          vehicleId: vehicleId || undefined,
          dueDate: serviceNeededAt ? serviceNeededAt.slice(0, 10) : undefined,
          customerId: customerId || undefined,
          customerSiteId: siteId || undefined,
          assetId: assetId || undefined,
          requestChannel: channel,
          serviceNeededAt: neededAt,
          entitlementType: entitlement || undefined,
          customFields: Object.keys(customFields).length ? customFields : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ticket) { setErr(data?.error ?? 'Failed to submit the request'); return; }
      let ticket = data.ticket as ServiceTicket;

      if (photos.length) {
        const fd = new FormData();
        photos.forEach((p) => fd.append('file', p));
        const up = await fetch(api.photosUrl(ticket.id), { method: 'POST', body: fd });
        const upData = await up.json().catch(() => null);
        if (up.ok && upData?.attachments) {
          ticket = { ...ticket, attachments: [...(ticket.attachments ?? []), ...upData.attachments] } as ServiceTicket;
        } else {
          // The request exists; tell the user the photos did not go through.
          alert(`Request ${ticket.readableId} was created, but the photos could not be attached: ${upData?.error ?? 'upload failed'}.`);
        }
      }
      onCreated(ticket);
    } finally {
      setSubmitting(false);
    }
  };

  const photoUrls = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => photoUrls.forEach((u) => URL.revokeObjectURL(u)), [photoUrls]);

  return (
    <form onSubmit={submit}>
      <FormPanel
        title="New Service Request"
        subtitle="Raise a field service request. Priority and SLA come from the Service Catalog & SLA master."
        icon={Wrench}
        accent="blue"
        actions={<SecondaryButton icon={X} onClick={onCancel}>Close</SecondaryButton>}
      >
        {err && <FormAlert>{err}</FormAlert>}

        {/* 1. Request details */}
        <FormSection title="Request details" icon={FileText} columns={3}>
          <FormField label="Request ID" hint="Assigned when the request is submitted">
            <TextInput readOnly value={nextRequestNo ?? (customerId ? 'Loading…' : 'Select a customer')} className="font-mono" />
          </FormField>
          <FormField label="Request channel">
            <SelectInput value={channel} onChange={(e) => setChannel(e.target.value)}>
              {(channels.length ? channels : [{ value: 'CUSTOMER_PORTAL', label: 'Customer Portal' }]).map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </SelectInput>
          </FormField>
          <FormField label="Created date & time" hint="Stamped when you submit">
            <TextInput readOnly value={fmtNow(now)} className="tabular-nums" aria-live="off" />
          </FormField>
        </FormSection>

        {/* 2. Customer info */}
        <FormSection title="Customer info" icon={User} columns={2}>
          <FormField label="Customer ID">
            <TextInput readOnly value={customer?.code ?? ''} placeholder="—" className="font-mono" />
          </FormField>
          <FormField label="Customer name" required={isFsmType}>
            <SelectInput value={customerId} disabled={!!fixedCustomerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
              <option value="">— Select a customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              {fixedCustomerId && customer && !customers.some((c) => c.id === customer.id) && (
                <option value={customer.id}>{customer.name} ({customer.code})</option>
              )}
            </SelectInput>
          </FormField>
          <FormField label="Entity / site" required={isFsmType}
            hint={customerId && sites.length === 0 ? 'No entities / sites yet — add one.' : undefined}>
            <div className="flex gap-2">
              <SelectInput value={siteId} disabled={!customerId} onChange={(e) => { setSiteId(e.target.value); setAssetId(''); }} aria-label="Entity / site">
                <option value="">— Select entity / site —</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}
              </SelectInput>
              {api.canAddSite && <SecondaryButton icon={Plus} disabled={!customerId} onClick={() => setAddingSite(true)} title="Add entity / site">Add</SecondaryButton>}
            </div>
          </FormField>
          <FormField label="Site address">
            <TextInput readOnly value={site ? [site.address, site.city].filter(Boolean).join(', ') || (site.latitude != null ? `${site.latitude.toFixed(5)}, ${site.longitude?.toFixed(5)}` : '') : ''} placeholder="—" />
          </FormField>
          <FormField label="Contact person">
            <TextInput readOnly value={site?.contactPerson ?? customer?.contactPerson ?? ''} placeholder="—" />
          </FormField>
          <FormField label="Mobile number">
            <TextInput readOnly value={site?.contactMobile ?? customer?.contactPhone ?? ''} placeholder="—" />
          </FormField>
        </FormSection>

        {/* 3. Service classification */}
        <FormSection title="Service classification" icon={ListTree} columns={2}>
          <FormField label="Service category" required>
            <SelectInput value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Service category">
              {typeGroups.map(([group, types]) => <option key={group} value={group}>{group} ({types.length})</option>)}
            </SelectInput>
          </FormField>
          <FormField label="Service type" required hint={tc?.description || undefined}>
            <SelectInput value={ticketType} onChange={(e) => setTicketType(e.target.value as TicketType)} aria-label="Service type">
              {categoryTypes.map((t) => <option key={t} value={t}>{typeConfigByType[t]!.name}</option>)}
            </SelectInput>
          </FormField>
          <div className="md:col-span-full grid grid-cols-2 md:grid-cols-4 gap-2" aria-label="Priority and SLA">
            <ReadOnlyValue label="Priority" value={priorityLabel(priority)}
              tone={priority === 'Critical' ? 'rose' : priority === 'High' ? 'amber' : priority === 'Medium' ? 'blue' : 'emerald'} />
            <ReadOnlyValue label="SLA response" value={catalogSla ? formatSlaHours(catalogSla.responseHours) : '—'} />
            <ReadOnlyValue label="SLA on-site arrival" value={catalogSla ? formatSlaHours(catalogSla.onSiteHours) : '—'} />
            <ReadOnlyValue label="SLA resolution" value={formatSlaHours(resolutionHours)} />
          </div>
          {willAwaitApproval && (
            <div className="md:col-span-full"><FormAlert tone="warning">This request will start in <strong>Awaiting Approval</strong>.</FormAlert></div>
          )}
        </FormSection>

        {/* 4. Service details */}
        <FormSection title="Service details" icon={Package} columns={2}>
          <FormField label="Asset / equipment ID"
            hint={siteId && siteAssets.length === 0 ? 'No equipment registered at this site yet — add it.' : 'Equipment registered at the selected entity / site'}>
            <div className="flex gap-2">
              <SelectInput value={assetId} disabled={!customerId} onChange={(e) => setAssetId(e.target.value)} aria-label="Asset / equipment">
                <option value="">— Select asset / equipment —</option>
                {siteAssets.map((a) => <option key={a.id} value={a.id}>{a.assetNo} · {a.name}</option>)}
              </SelectInput>
              {api.canAddAsset && <SecondaryButton icon={Plus} disabled={!customerId} onClick={() => setAddingAsset(true)} title="Register equipment">Add</SecondaryButton>}
            </div>
          </FormField>
          <FormField label="S.No / Tag ID">
            <TextInput readOnly value={asset ? [asset.serialNumber, asset.tagId].filter(Boolean).join(' / ') : ''} placeholder="—" className="font-mono" />
          </FormField>
          <FormField label="Asset name & description" span="full">
            <TextInput readOnly placeholder="—"
              value={asset ? [asset.name, asset.description, [asset.manufacturer, asset.model].filter(Boolean).join(' ')].filter(Boolean).join(' — ') : ''} />
          </FormField>
          <FormField label="Request subject" required span="full">
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required placeholder="Short summary of the problem or service needed" />
          </FormField>
          <FormField label="Request description" span="full" hint="What is happening, since when, and anything the technician should know">
            <TextAreaInput value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </FormField>
          <FormField label="Photos" hint="Up to 6 photos (PNG, JPEG, WebP), 10 MB each">
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-main)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]">
              <Camera className="w-4 h-4" /> {photos.length ? `${photos.length} photo(s) selected — add more` : 'Attach photos'}
              <input type="file" accept="image/png,image/jpeg,image/webp" multiple className="sr-only"
                onChange={(e) => { const f = Array.from(e.target.files ?? []); setPhotos((p) => [...p, ...f].slice(0, 6)); e.target.value = ''; }} />
            </label>
          </FormField>
          <FormField label="Service needed at" required hint="Date & time the service is needed">
            <TextInput type="datetime-local" value={serviceNeededAt} onChange={(e) => setServiceNeededAt(e.target.value)} required />
          </FormField>
          {photos.length > 0 && (
            <div className="md:col-span-full flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-subtle)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrls[i]} alt={p.name} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 rounded bg-black/60 p-0.5 text-white" aria-label={`Remove ${p.name}`}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {tc?.vehicleRequired && (
            <FormField label="Vehicle" required span="full">
              <SelectInput value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                <option value="">— Select a vehicle —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vehicleCode ?? v.id.slice(0, 8)}{v.licensePlate ? ` · ${v.licensePlate}` : ''}{v.make || v.model ? ` · ${[v.make, v.model].filter(Boolean).join(' ')}` : ''}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          )}
          {formFields.map((f) => (
            <DynamicField key={`${ticketType}:${f.key}`} field={f} value={customFields[f.key]} onChange={(v) => setField(f.key, v)} />
          ))}
        </FormSection>

        {/* 5. Entitlement / billing */}
        <FormSection title="Entitlement / billing" icon={Receipt} columns={2}>
          <FormField label="Entitlement / billing type" hint="How this service is covered">
            <SelectInput value={entitlement} onChange={(e) => setEntitlement(e.target.value)}>
              <option value="">— Select —</option>
              {entitlements.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </SelectInput>
          </FormField>
        </FormSection>

        <FormFooter secondary={<SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>}>
          <PrimaryButton type="submit" icon={Send} busy={submitting}>{submitting ? 'Submitting…' : 'Submit request'}</PrimaryButton>
        </FormFooter>
      </FormPanel>

      {addingSite && customerId && (
        <AddSiteDialog url={api.addSiteUrl(customerId)} onClose={() => setAddingSite(false)}
          onSaved={(s) => { setAddingSite(false); void loadContext(customerId, { siteId: s.id }); }} />
      )}
      {addingAsset && customerId && (
        <AddAssetDialog url={api.addAssetUrl(customerId)} sites={sites} defaultSiteId={siteId} onClose={() => setAddingAsset(false)}
          onSaved={(a) => { setAddingAsset(false); void loadContext(customerId, { siteId: a.customerSiteId ?? siteId, assetId: a.id }); }} />
      )}
    </form>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────────

function Dialog({ title, icon: Icon, onClose, children }: { title: string; icon: typeof Building2; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-xl">
        <FormPanel title={title} icon={Icon} actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}>
          {children}
        </FormPanel>
      </div>
    </div>
  );
}

function AddSiteDialog({ url, onClose, onSaved }: { url: string; onClose: () => void; onSaved: (s: Site) => void }) {
  const [f, setF] = useState({ name: '', address: '', city: '', contactPerson: '', contactMobile: '', latitude: '', longitude: '' });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setErr(null);
    if (!f.name.trim()) { setErr('Entity / site name is required.'); return; }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, latitude: f.latitude || null, longitude: f.longitude || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.site) { setErr(data?.error ?? 'Could not add the entity / site'); return; }
      onSaved(data.site);
    } finally { setBusy(false); }
  };

  return (
    <Dialog title="Add entity / site" icon={Building2} onClose={onClose}>
      {err && <FormAlert>{err}</FormAlert>}
      <FormSection title="Entity / site" icon={Building2} columns={2}>
        <FormField label="Entity / site name" required span="full"><TextInput value={f.name} onChange={set('name')} autoFocus /></FormField>
        <FormField label="Address" span="full"><TextInput value={f.address} onChange={set('address')} /></FormField>
        <FormField label="City"><TextInput value={f.city} onChange={set('city')} /></FormField>
        <FormField label="Map location" hint={f.latitude ? `${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}` : 'Optional — pin the site on the map'}>
          <SecondaryButton icon={MapPin} onClick={() => setPicking(true)}>{f.latitude ? 'Change pin' : 'Tag on map'}</SecondaryButton>
        </FormField>
        <FormField label="Contact person"><TextInput value={f.contactPerson} onChange={set('contactPerson')} /></FormField>
        <FormField label="Mobile number"><TextInput value={f.contactMobile} onChange={set('contactMobile')} placeholder="+971 5x xxx xxxx" /></FormField>
      </FormSection>
      <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
        <PrimaryButton icon={Plus} busy={busy} onClick={() => void save()}>Add entity / site</PrimaryButton>
      </FormFooter>
      <LocationPickerModal open={picking} title="Tag the entity / site on the map"
        initial={f.latitude ? { lat: Number(f.latitude), lng: Number(f.longitude) } : null}
        onClose={() => setPicking(false)}
        onPick={(loc: PickedLocation) => {
          setPicking(false);
          setF((p) => ({ ...p, latitude: String(loc.lat), longitude: String(loc.lng), address: p.address || loc.address, name: p.name || loc.name }));
        }} />
    </Dialog>
  );
}

function AddAssetDialog({ url, sites, defaultSiteId, onClose, onSaved }: {
  url: string; sites: Site[]; defaultSiteId: string; onClose: () => void; onSaved: (a: Asset) => void;
}) {
  const [f, setF] = useState({ name: '', customerSiteId: defaultSiteId, serialNumber: '', tagId: '', manufacturer: '', model: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setErr(null);
    if (!f.name.trim()) { setErr('Asset / equipment name is required.'); return; }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, kind: 'EQUIPMENT' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.asset) { setErr(data?.error ?? 'Could not register the equipment'); return; }
      onSaved(data.asset);
    } finally { setBusy(false); }
  };

  return (
    <Dialog title="Register asset / equipment" icon={Package} onClose={onClose}>
      {err && <FormAlert>{err}</FormAlert>}
      <FormSection title="Asset / equipment" icon={Package} columns={2}>
        <FormField label="Name" required span="full"><TextInput value={f.name} onChange={set('name')} autoFocus placeholder="e.g. Chiller unit 2" /></FormField>
        <FormField label="Entity / site">
          <SelectInput value={f.customerSiteId} onChange={set('customerSiteId')}>
            <option value="">— Not tied to a site —</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </SelectInput>
        </FormField>
        <FormField label="Serial number"><TextInput value={f.serialNumber} onChange={set('serialNumber')} /></FormField>
        <FormField label="Tag ID"><TextInput value={f.tagId} onChange={set('tagId')} /></FormField>
        <FormField label="Manufacturer"><TextInput value={f.manufacturer} onChange={set('manufacturer')} /></FormField>
        <FormField label="Model"><TextInput value={f.model} onChange={set('model')} /></FormField>
        <FormField label="Description" span="full"><TextInput value={f.description} onChange={set('description')} /></FormField>
      </FormSection>
      <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
        <PrimaryButton icon={Plus} busy={busy} onClick={() => void save()}>Register equipment</PrimaryButton>
      </FormFooter>
    </Dialog>
  );
}

// ── Type-specific fields ───────────────────────────────────────────────────

function DynamicField({ field, value, onChange }: { field: FormFieldDef; value: unknown; onChange: (v: unknown) => void }) {
  if (field.type === 'checkbox') {
    return (
      <div className="md:col-span-full">
        <CheckboxField label={field.required ? `${field.label} *` : field.label} checked={!!value} onChange={(v) => onChange(v)} />
      </div>
    );
  }
  const span = field.type === 'textarea' ? ('full' as const) : undefined;
  if (field.type === 'select') {
    return (
      <FormField label={field.label} required={field.required} span={span}>
        <SelectInput value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} required={field.required}>
          <option value="">— Select —</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </SelectInput>
      </FormField>
    );
  }
  if (field.type === 'textarea') {
    return (
      <FormField label={field.label} required={field.required} span={span}>
        <TextAreaInput value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} required={field.required} rows={3} />
      </FormField>
    );
  }
  const inputType = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : 'text';
  return (
    <FormField label={field.label} required={field.required}>
      <TextInput type={inputType} value={(value as string | number | undefined) ?? ''}
        onChange={(e) => { const v = e.target.value; onChange(field.type === 'number' ? (v === '' ? undefined : Number(v)) : v); }}
        placeholder={field.placeholder} required={field.required} min={field.min} max={field.max} />
    </FormField>
  );
}

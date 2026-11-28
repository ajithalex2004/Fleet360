'use client';

/**
 * Customer Management → Transport Services catalogue & Dynamic Form Builder.
 *
 * Tenant admins manage:
 *  1. Built-in & Custom Categories (enable/disable independently for Customer
 *     Portal and Internal Booking Portal, plus approval & dynamic module
 *     mapping via SERVICE_MODULE_MAP).
 *  2. Custom Sections & Custom Fields inside any section (text, select,
 *     number, date, time, textarea, toggle, email, tel).
 *  3. Per-field Show/Hide, Required/Optional, and Default Field Values
 *     (pre-populated automatically in both Customer Portal and Booking Portal).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Truck,
  Eye,
  ListChecks,
  Save,
  RotateCcw,
  Lock,
  CheckCircle2,
  Menu as MenuIcon,
  Plus,
  Trash2,
  X,
  Sparkles,
  FolderPlus,
  SlidersHorizontal,
  ListPlus,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import {
  FormPanel,
  FormSection,
  FormField,
  FormAlert,
  FormFooter,
  PrimaryButton,
  SecondaryButton,
  CheckboxField,
  TextInput,
  SelectInput,
} from '@/components/ui/form-kit';
import { DynamicRequestForm } from '@/components/forms/DynamicRequestForm';
import {
  normalizeCategoryCode,
  type TransportCategoryCode,
} from '@/lib/customer-portal/catalog';
import {
  CATEGORY_ACCENTS,
  LINKABLE_MODULES,
  type CategoryAccent,
} from '@/lib/booking-portal/service-module-map';
import {
  CUSTOM_CATEGORY_TEMPLATES,
  type CustomCategoryTemplate,
} from '@/lib/transport-catalog/default-forms';
import {
  REQUEST_FIELD_TYPES,
  allFields,
  applyOverrides,
  extractDefaultValues,
  mergeCustomForm,
  sameOptionsList,
  slugifyFieldKey,
  slugifySectionKey,
  validateRequestValues,
  type CustomFieldDef,
  type CustomFormConfig,
  type CustomSectionDef,
  type FieldOverrides,
  type RequestFieldDef,
  type RequestFieldType,
  type RequestFormDef,
  type RequestValue,
  type RequestValues,
} from '@/lib/transport-catalog/form-schema';

interface TenantCategory {
  category: TransportCategoryCode;
  bookingServiceType: string;
  isCustom: boolean;
  title: string;
  description: string;
  vehicleUsage: string;
  icon: string;
  badge: string;
  accent: CategoryAccent;
  moduleKey: string | null;
  customModuleKey: string | null;
  moduleEnabled: boolean;
  menu: string[];
  form: RequestFormDef;
  effectiveForm: RequestFormDef;
  defaultValues: RequestValues;
  enabled: boolean;
  bookingPortalEnabled: boolean;
  approvalRequired: boolean;
  fieldOverrides: FieldOverrides;
  customFormConfig: CustomFormConfig;
}

const COMMON_MENU = ['New request', 'Active requests', 'History'];
const ICON_CHOICES = ['🚐', '🚗', '🚌', '🚛', '⭐', '🏫', '🚑', '✈️', '🛥️', '📦', '🔧', '🚕'];

export default function TransportCatalogPage() {
  const [cats, setCats] = useState<TenantCategory[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [transportPortalEnabled, setTransportPortalEnabled] = useState(true);
  const [showDisabledModules, setShowDisabledModules] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/customers/transport-catalog', { cache: 'no-store' });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) {
      setErr(d?.error ?? 'Could not load the catalogue');
      return;
    }
    const list: TenantCategory[] = d.categories ?? [];
    setCats(list);
    setCanEdit(!!d.canEdit);
    if (typeof d.transportPortalEnabled === 'boolean') setTransportPortalEnabled(d.transportPortalEnabled);
    setSelected((s) => {
      if (s && list.some((c) => c.category === s)) return s;
      return list.find((c) => c.moduleEnabled !== false)?.category ?? list[0]?.category ?? null;
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (category: string, patch: Record<string, unknown>) => {
    setErr(null);
    const res = await fetch('/api/customers/transport-catalog', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, ...patch }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) {
      setErr(d?.error ?? 'Could not save');
      return false;
    }
    setCats((cs) => cs?.map((c) => (c.category === category ? d.category : c)) ?? cs);
    return true;
  }, []);

  const handleCreated = useCallback((created: TenantCategory) => {
    setCats((cs) => (cs ? [...cs, created] : [created]));
    setSelected(created.category);
    setShowCreateModal(false);
  }, []);

  const handleDeleteCustom = useCallback(async (category: string, title: string) => {
    if (!window.confirm(`Delete custom category "${title}" (${category})? Existing submitted requests keep their records.`)) {
      return;
    }
    setErr(null);
    const res = await fetch(`/api/customers/transport-catalog?category=${encodeURIComponent(category)}`, {
      method: 'DELETE',
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) {
      setErr(d?.error ?? 'Could not delete category');
      return;
    }
    setCats((cs) => {
      const next = cs?.filter((c) => c.category !== category) ?? [];
      setSelected(next[0]?.category ?? null);
      return next;
    });
  }, []);

  const disabledModuleCount = useMemo(
    () => (cats ?? []).filter((c) => c.moduleEnabled === false).length,
    [cats],
  );
  const visibleCats = useMemo(() => {
    if (!cats) return null;
    if (showDisabledModules) return cats;
    const enabledOnly = cats.filter((c) => c.moduleEnabled !== false);
    return enabledOnly.length > 0 ? enabledOnly : cats;
  }, [cats, showDisabledModules]);

  const current = cats?.find((c) => c.category === selected) ?? null;
  const offered = cats?.filter((c) => c.enabled && c.moduleEnabled !== false).length ?? 0;

  return (
    <div className="space-y-5 max-w-7xl">
      <PageHeader
        title="Transport Services catalogue & Form Builder"
        icon={Truck}
        accent="blue"
        subtitle="Manage built-in and custom categories per portal, map modules, add custom sections & fields, and configure default field values for both the Customer Portal and Internal Booking Portal."
        actions={
          canEdit ? (
            <PrimaryButton icon={Plus} onClick={() => setShowCreateModal(true)}>
              Add Category
            </PrimaryButton>
          ) : undefined
        }
      />

      {err && <FormAlert>{err}</FormAlert>}
      {!transportPortalEnabled && cats && (
        <FormAlert tone="warning">
          The <strong>Transport Services Customer Portal</strong> is currently disabled for this tenant in{' '}
          <Link href="/admin/tenants" className="underline font-semibold">Admin → Tenants → Modules</Link>.
          You can still customize forms for the Internal Booking Portal, or ask a platform admin to enable Transport Services for customers.
        </FormAlert>
      )}
      {!canEdit && cats && (
        <FormAlert tone="info">View only. A tenant admin can edit categories, custom fields, and defaults.</FormAlert>
      )}
      {cats && transportPortalEnabled && offered === 0 && (
        <FormAlert tone="warning">
          No Transport category is offered to external customers yet. Turn on the ones you provide for Customer Portal;
          Booking Portal visibility can be toggled independently on each category.
        </FormAlert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[21rem_minmax(0,1fr)] gap-4 items-start">
        <div className="space-y-2">
          {!visibleCats && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
          {visibleCats?.map((c) => {
            const overrideCount = Object.keys(c.fieldOverrides).length;
            const customFieldCount = c.customFormConfig.fields?.length ?? 0;
            const customSectionCount = c.customFormConfig.sections?.length ?? 0;
            const defaultCount = Object.keys(c.defaultValues).length;
            const lockedByModule = c.moduleEnabled === false;
            const offerDisabled = !canEdit || (!c.enabled && (lockedByModule || !transportPortalEnabled));
            return (
              <div
                key={c.category}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(c.category)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSelected(c.category);
                }}
                className={`rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                  c.category === selected
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]'
                } ${lockedByModule ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-start gap-2">
                    <span className="text-base leading-none mt-0.5">{c.icon}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-bold truncate">{c.title}</p>
                        {c.isCustom && (
                          <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[9px] font-bold uppercase text-cyan-600 dark:text-cyan-300">
                            Custom
                          </span>
                        )}
                        {lockedByModule && (
                          <span className="px-1.5 py-0.2 rounded-full bg-amber-500/15 border border-amber-500/30 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                            Module off
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] line-clamp-1">{c.description}</p>
                    </div>
                  </div>
                  <label
                    className={`inline-flex items-center gap-1.5 text-[11px] font-semibold flex-shrink-0 ${offerDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      disabled={offerDisabled}
                      aria-label={`Offer ${c.title}`}
                      onChange={() => void save(c.category, { enabled: !c.enabled })}
                      className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                    />
                    {c.enabled ? 'Offered' : 'Off'}
                  </label>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                  <span
                    className={`px-1.5 py-0.5 rounded border font-semibold ${
                      c.bookingPortalEnabled
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    Booking: {c.bookingPortalEnabled ? 'On' : 'Off'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded border border-[var(--border-subtle)] font-mono">
                    {c.moduleKey ? `mod:${c.moduleKey}` : 'all-staff'}
                  </span>
                  {customFieldCount > 0 && <span>+{customFieldCount} field{customFieldCount > 1 ? 's' : ''}</span>}
                  {customSectionCount > 0 && <span>+{customSectionCount} sec</span>}
                  {defaultCount > 0 && <span>{defaultCount} default{defaultCount > 1 ? 's' : ''}</span>}
                  {overrideCount === 0 && customFieldCount === 0 && customSectionCount === 0 && <span>Default form</span>}
                </div>
              </div>
            );
          })}
          {disabledModuleCount > 0 && (
            <button
              type="button"
              onClick={() => setShowDisabledModules((v) => !v)}
              className="w-full rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] transition-colors"
            >
              {showDisabledModules
                ? `Hide ${disabledModuleCount} unavailable Admin module categor${disabledModuleCount === 1 ? 'y' : 'ies'}`
                : `Show ${disabledModuleCount} categor${disabledModuleCount === 1 ? 'y' : 'ies'} gated by disabled Admin modules`}
            </button>
          )}
        </div>

        {current && (
          <CategoryEditor
            key={current.category}
            cat={current}
            canEdit={canEdit}
            transportPortalEnabled={transportPortalEnabled}
            onSave={save}
            onDeleteCustom={handleDeleteCustom}
          />
        )}
      </div>

      {showCreateModal && (
        <CreateCategoryModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category Editor (Portal toggles, Module map, Sections/Fields/Defaults builder)
// ─────────────────────────────────────────────────────────────────────────────

function CategoryEditor({
  cat,
  canEdit,
  transportPortalEnabled,
  onSave,
  onDeleteCustom,
}: {
  cat: TenantCategory;
  canEdit: boolean;
  transportPortalEnabled: boolean;
  onSave: (c: string, patch: Record<string, unknown>) => Promise<boolean>;
  onDeleteCustom: (c: string, title: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'fields' | 'preview'>('fields');
  const [draftOverrides, setDraftOverrides] = useState<FieldOverrides>(cat.fieldOverrides);
  const [draftCustom, setDraftCustom] = useState<CustomFormConfig>(cat.customFormConfig);
  const [showAppearance, setShowAppearance] = useState(false);
  const [metaDraft, setMetaDraft] = useState({
    title: cat.title,
    description: cat.description,
    icon: cat.icon,
    badge: cat.badge,
    accent: cat.accent,
  });

  // Inline section, field, and select-options builder state
  const [addingSection, setAddingSection] = useState(false);
  const [newSecTitle, setNewSecTitle] = useState('');
  const [addingFieldInSection, setAddingFieldInSection] = useState<string | null>(null);
  const [editingOptionsFieldKey, setEditingOptionsFieldKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const mergedForm = useMemo(() => mergeCustomForm(cat.form, draftCustom), [cat.form, draftCustom]);
  const previewForm = useMemo(
    () => applyOverrides(cat.form, draftOverrides, draftCustom),
    [cat.form, draftOverrides, draftCustom]
  );

  const formDirty =
    JSON.stringify(draftOverrides) !== JSON.stringify(cat.fieldOverrides) ||
    JSON.stringify(draftCustom) !== JSON.stringify(cat.customFormConfig);

  const metaDirty =
    metaDraft.title !== cat.title ||
    metaDraft.description !== cat.description ||
    metaDraft.icon !== cat.icon ||
    metaDraft.badge !== cat.badge ||
    metaDraft.accent !== cat.accent;

  const setFlag = (key: string, flag: 'hidden' | 'required', value: boolean, defaultRequired: boolean) => {
    setSaved(false);
    setLocalErr(null);
    setDraftOverrides((d) => {
      const next = { ...(d[key] ?? {}) };
      if (flag === 'hidden') {
        if (value) next.hidden = true;
        else delete next.hidden;
      } else if (value === defaultRequired) {
        delete next.required;
      } else {
        next.required = value;
      }
      const out = { ...d };
      if (Object.keys(next).length) out[key] = next;
      else delete out[key];
      return out;
    });
  };

  const setDefaultValue = (field: RequestFieldDef, rawVal: RequestValue | undefined) => {
    setSaved(false);
    setLocalErr(null);

    // If it's a custom field, store defaultValue directly on the custom field definition too
    if (field.custom) {
      setDraftCustom((c) => ({
        ...c,
        fields: (c.fields ?? []).map((cf) => {
          if (cf.key !== field.key) return cf;
          const next = { ...cf };
          if (rawVal === undefined || rawVal === '') delete next.defaultValue;
          else next.defaultValue = rawVal;
          return next;
        }),
      }));
      return;
    }

    setDraftOverrides((d) => {
      const next = { ...(d[field.key] ?? {}) };
      if (rawVal === undefined || rawVal === '' || rawVal === field.defaultValue) {
        delete next.defaultValue;
      } else {
        next.defaultValue = rawVal;
      }
      const out = { ...d };
      if (Object.keys(next).length) out[field.key] = next;
      else delete out[field.key];
      return out;
    });
  };

  const setSelectOptions = (field: RequestFieldDef, nextOptions: string[]) => {
    if (nextOptions.length === 0) return;
    setSaved(false);
    setLocalErr(null);

    if (field.custom) {
      setDraftCustom((c) => ({
        ...c,
        fields: (c.fields ?? []).map((cf) => {
          if (cf.key !== field.key) return cf;
          const next = { ...cf, options: nextOptions };
          if (typeof next.defaultValue === 'string' && !nextOptions.includes(next.defaultValue)) {
            delete next.defaultValue;
          }
          return next;
        }),
      }));
      return;
    }

    setDraftOverrides((d) => {
      const next = { ...(d[field.key] ?? {}) };
      if (sameOptionsList(nextOptions, field.options)) {
        delete next.options;
      } else {
        next.options = nextOptions;
      }
      if (typeof next.defaultValue === 'string' && !nextOptions.includes(next.defaultValue)) {
        delete next.defaultValue;
      }
      const out = { ...d };
      if (Object.keys(next).length) out[field.key] = next;
      else delete out[field.key];
      return out;
    });
  };

  const handleAddSection = () => {
    const title = newSecTitle.trim();
    if (!title) return;
    const baseKey = slugifySectionKey(title);
    const existingKeys = new Set(mergedForm.sections.map((s) => s.key));
    let key = baseKey;
    let i = 2;
    while (existingKeys.has(key)) {
      key = `${baseKey.slice(0, 44)}_${i++}`;
    }
    const newSec: CustomSectionDef = { key, title };
    setDraftCustom((c) => ({
      ...c,
      sections: [...(c.sections ?? []), newSec],
    }));
    setNewSecTitle('');
    setAddingSection(false);
    setAddingFieldInSection(key);
    setSaved(false);
  };

  const handleRemoveCustomSection = (sectionKey: string) => {
    if (!window.confirm('Remove this custom section and any custom fields inside it?')) return;
    const removedFieldKeys = new Set(
      (draftCustom.fields ?? []).filter((f) => f.sectionKey === sectionKey).map((f) => f.key)
    );
    setDraftCustom((c) => ({
      ...c,
      sections: (c.sections ?? []).filter((s) => s.key !== sectionKey),
      fields: (c.fields ?? []).filter((f) => f.sectionKey !== sectionKey),
    }));
    if (removedFieldKeys.size > 0) {
      setDraftOverrides((d) => {
        const out = { ...d };
        for (const k of removedFieldKeys) delete out[k];
        return out;
      });
    }
    setSaved(false);
  };

  const handleAddCustomField = (field: CustomFieldDef) => {
    setDraftCustom((c) => ({
      ...c,
      fields: [...(c.fields ?? []), field],
    }));
    setAddingFieldInSection(null);
    setSaved(false);
  };

  const handleToggleCustomFieldRequired = (key: string, required: boolean) => {
    setDraftCustom((c) => ({
      ...c,
      fields: (c.fields ?? []).map((cf) => (cf.key === key ? { ...cf, required: required || undefined } : cf)),
    }));
    setSaved(false);
  };

  const handleRemoveCustomField = (key: string) => {
    setDraftCustom((c) => ({
      ...c,
      fields: (c.fields ?? []).filter((cf) => cf.key !== key),
    }));
    setDraftOverrides((d) => {
      if (!(key in d)) return d;
      const out = { ...d };
      delete out[key];
      return out;
    });
    setSaved(false);
  };

  const saveFormChanges = async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      const ok = await onSave(cat.category, {
        fieldOverrides: draftOverrides,
        customFormConfig: draftCustom,
      });
      if (ok) setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const saveAppearance = async () => {
    setBusy(true);
    setLocalErr(null);
    try {
      const ok = await onSave(cat.category, metaDraft);
      if (ok) setShowAppearance(false);
    } finally {
      setBusy(false);
    }
  };

  const currentModuleSelectValue = cat.customModuleKey !== null ? cat.customModuleKey : (cat.moduleKey ?? '');

  return (
    <FormPanel
      title={`${cat.icon} ${cat.title}`}
      subtitle={`${cat.description} · code: ${cat.category}${cat.bookingServiceType !== cat.category ? ` (Booking: ${cat.bookingServiceType})` : ''}`}
      icon={Truck}
      actions={
        <div className="flex flex-wrap gap-1.5">
          <SecondaryButton
            icon={ListChecks}
            onClick={() => setTab('fields')}
            className={tab === 'fields' ? '!border-blue-500/50 !text-blue-600' : ''}
          >
            Fields & Defaults
          </SecondaryButton>
          <SecondaryButton
            icon={Eye}
            onClick={() => setTab('preview')}
            className={tab === 'preview' ? '!border-blue-500/50 !text-blue-600' : ''}
          >
            Live Preview
          </SecondaryButton>
          {canEdit && (
            <SecondaryButton
              icon={SlidersHorizontal}
              onClick={() => setShowAppearance((v) => !v)}
              className={showAppearance ? '!border-cyan-500/50 !text-cyan-600' : ''}
            >
              Card Info
            </SecondaryButton>
          )}
          {canEdit && cat.isCustom && (
            <SecondaryButton
              icon={Trash2}
              onClick={() => void onDeleteCustom(cat.category, cat.title)}
              className="!text-rose-600 hover:!border-rose-500/40"
            >
              Delete
            </SecondaryButton>
          )}
        </div>
      }
    >
      {localErr && <FormAlert>{localErr}</FormAlert>}

      {/* Portal Availability & Module Mapping (SERVICE_MODULE_MAP) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-main)]/60 p-3.5">
        <div className="space-y-3">
          <CheckboxField
            label="Offer in Customer Portal"
            checked={cat.enabled}
            disabled={!canEdit || (!cat.enabled && (!transportPortalEnabled || cat.moduleEnabled === false))}
            hint={
              !transportPortalEnabled
                ? 'Transport Services Customer Portal is disabled in Admin → Tenants → Modules'
                : cat.moduleEnabled === false
                  ? `Module "${cat.moduleKey}" is disabled in Admin → Tenants → Modules (enable it or switch Linked Module Gate to All Staff)`
                  : 'Only offered categories can be assigned to customers in Portal Access'
            }
            onChange={(v) => void onSave(cat.category, { enabled: v })}
          />
          <CheckboxField
            label="Show in Internal Booking Portal"
            checked={cat.bookingPortalEnabled}
            disabled={!canEdit}
            hint="Controls whether staff see this category card in /booking-portal and /booking-portal/new"
            onChange={(v) => void onSave(cat.category, { bookingPortalEnabled: v })}
          />
          <CheckboxField
            label="Requests need approval"
            checked={cat.approvalRequired}
            disabled={!canEdit}
            hint="Customer requests wait in Pending Approval before dispatch"
            onChange={(v) => void onSave(cat.category, { approvalRequired: v })}
          />
        </div>

        <div className="space-y-3">
          <FormField
            label="Linked Module Gate (SERVICE_MODULE_MAP)"
            hint="Restricts visibility in Internal Booking Portal to tenants with this module enabled, or select All Staff for everyone."
          >
            <SelectInput
              value={currentModuleSelectValue}
              disabled={!canEdit}
              onChange={(e) => void onSave(cat.category, { moduleKey: e.target.value })}
            >
              {LINKABLE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </SelectInput>
          </FormField>

          <div>
            <p className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
              <MenuIcon className="w-3 h-3" /> Customer Portal Menu
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[...COMMON_MENU, ...cat.menu].map((m) => (
                <span
                  key={m}
                  className="px-2 py-0.5 rounded-full border border-[var(--border-subtle)] text-[10px] font-semibold"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Optional Card Appearance Editor */}
      {showAppearance && canEdit && (
        <FormSection title="Category Card Appearance" columns={2}>
          <FormField label="Display Title">
            <TextInput
              value={metaDraft.title}
              onChange={(e) => setMetaDraft((m) => ({ ...m, title: e.target.value }))}
              maxLength={60}
            />
          </FormField>
          <FormField label="Card Badge">
            <TextInput
              value={metaDraft.badge}
              onChange={(e) => setMetaDraft((m) => ({ ...m, badge: e.target.value.toUpperCase() }))}
              maxLength={16}
            />
          </FormField>
          <FormField label="Description" span="full">
            <TextInput
              value={metaDraft.description}
              onChange={(e) => setMetaDraft((m) => ({ ...m, description: e.target.value }))}
              maxLength={200}
            />
          </FormField>
          <FormField label="Icon">
            <div className="flex flex-wrap gap-1.5">
              {ICON_CHOICES.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setMetaDraft((m) => ({ ...m, icon: ic }))}
                  className={`w-8 h-8 rounded-lg border text-base flex items-center justify-center transition-colors ${
                    metaDraft.icon === ic
                      ? 'border-blue-500 bg-blue-500/15'
                      : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
          </FormField>
          <FormField label="Accent Color">
            <SelectInput
              value={metaDraft.accent}
              onChange={(e) => setMetaDraft((m) => ({ ...m, accent: e.target.value as CategoryAccent }))}
            >
              {CATEGORY_ACCENTS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </SelectInput>
          </FormField>
          <div className="md:col-span-full flex justify-end gap-2">
            <SecondaryButton onClick={() => setShowAppearance(false)}>Cancel</SecondaryButton>
            <PrimaryButton icon={Save} busy={busy} disabled={!metaDirty} onClick={() => void saveAppearance()}>
              Save Card Info
            </PrimaryButton>
          </div>
        </FormSection>
      )}

      {tab === 'fields' ? (
        <>
          {/* Section toolbar */}
          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-main)]/40 px-3.5 py-2.5">
              <div className="text-xs text-[var(--text-muted)]">
                Add custom sections, add fields inside any section, edit dropdown options (<strong>Edit Values</strong>), toggle visibility/required, or set default values pre-filled on both portals.
              </div>
              {!addingSection ? (
                <SecondaryButton icon={FolderPlus} onClick={() => setAddingSection(true)}>
                  Add Section
                </SecondaryButton>
              ) : (
                <div className="flex items-center gap-2">
                  <TextInput
                    value={newSecTitle}
                    onChange={(e) => setNewSecTitle(e.target.value)}
                    placeholder="Section title (e.g. Project Billing)"
                    className="!w-56"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddSection();
                    }}
                  />
                  <PrimaryButton icon={Plus} onClick={handleAddSection} disabled={!newSecTitle.trim()}>
                    Create
                  </PrimaryButton>
                  <SecondaryButton icon={X} onClick={() => { setAddingSection(false); setNewSecTitle(''); }}>
                    Cancel
                  </SecondaryButton>
                </div>
              )}
            </div>
          )}

          {/* Sections & Field Rows */}
          {mergedForm.sections.map((s) => (
            <FormSection
              key={s.key}
              title={`${s.title}${s.custom ? ' (Custom Section)' : ''}`}
              columns={1}
            >
              <div className="flex items-center justify-between gap-2 pb-2 mb-1 border-b border-[var(--border-subtle)]">
                <span className="text-[10px] font-mono text-[var(--text-muted)]">section: {s.key}</span>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingFieldInSection(addingFieldInSection === s.key ? null : s.key)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-blue-500/35 bg-blue-500/10 hover:bg-blue-500/20 text-[11px] font-semibold text-blue-600 dark:text-blue-300 transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add Field
                    </button>
                    {s.custom && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomSection(s.key)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-500/30 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> Remove Section
                      </button>
                    )}
                  </div>
                )}
              </div>

              {s.fields.length === 0 && (
                <p className="text-xs text-[var(--text-muted)] py-2">
                  No fields in this section yet. Click <strong>Add Field</strong> above to add one.
                </p>
              )}

              <div className="divide-y divide-[var(--border-subtle)]">
                {s.fields.map((f) => {
                  const o = draftOverrides[f.key] ?? {};
                  const hidden = !f.core && !f.custom && !!o.hidden;
                  const required = f.core ? true : f.custom ? !!f.required : o.required ?? !!f.required;
                  const isSelect = f.type === 'select';
                  const effectiveOptions = isSelect
                    ? (f.custom ? (f.options ?? []) : (o.options ?? f.options ?? []))
                    : undefined;
                  const hasCustomOptions = isSelect && !f.custom && !!o.options && !sameOptionsList(o.options, f.options);
                  const rawDefault = f.custom
                    ? f.defaultValue
                    : o.defaultValue !== undefined
                      ? o.defaultValue
                      : f.defaultValue;
                  const effectiveDefault =
                    isSelect && typeof rawDefault === 'string' && effectiveOptions && !effectiveOptions.includes(rawDefault)
                      ? undefined
                      : rawDefault;
                  const isEditingOptions = editingOptionsFieldKey === f.key;

                  return (
                    <div key={f.key} className={`py-2.5 space-y-2 ${hidden ? 'opacity-50' : ''}`}>
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs font-semibold">{f.label}</p>
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">{f.key}</span>
                            {f.custom && (
                              <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-[9px] font-bold uppercase text-cyan-600 dark:text-cyan-300">
                                Custom
                              </span>
                            )}
                            {hasCustomOptions && (
                              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-bold uppercase text-emerald-700 dark:text-emerald-300">
                                Custom Values
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <p className="text-[10px] text-[var(--text-muted)]">
                              {f.type}
                              {effectiveOptions ? ` · ${effectiveOptions.length} options` : ''}
                              {f.unit ? ` · unit: ${f.unit}` : ''}
                              {f.showIf ? ' · conditional' : ''}
                            </p>
                            {isSelect && canEdit && !hidden && (
                              <button
                                type="button"
                                onClick={() => setEditingOptionsFieldKey(isEditingOptions ? null : f.key)}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-colors ${
                                  isEditingOptions
                                    ? 'border-blue-500/50 bg-blue-500/15 text-blue-700 dark:text-blue-300'
                                    : 'border-[var(--border-subtle)] bg-[var(--bg-main)] hover:border-blue-500/40 hover:text-blue-600 dark:hover:text-blue-300 text-[var(--text-muted)]'
                                }`}
                              >
                                <ListPlus className="w-3 h-3" />
                                {isEditingOptions ? 'Close Values' : 'Edit Values'}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Default Value Control (available for ALL fields including core & custom) */}
                        <div className="flex items-center gap-1.5 min-w-[210px] max-w-[260px]">
                          <DefaultValueInput
                            field={{ ...f, options: effectiveOptions }}
                            value={effectiveDefault}
                            disabled={!canEdit || hidden}
                            onChange={(val) => setDefaultValue(f, val)}
                          />
                          {canEdit && effectiveDefault !== undefined && effectiveDefault !== '' && (
                            <button
                              type="button"
                              title="Clear default value"
                              onClick={() => setDefaultValue(f, undefined)}
                              className="p-1 rounded hover:bg-[var(--bg-surface-hover)] text-[var(--text-muted)]"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {/* Visibility / Required / Delete Controls */}
                        {f.core ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] min-w-[140px] justify-end">
                            <Lock className="w-3 h-3" /> Core (required)
                          </span>
                        ) : f.custom ? (
                          <div className="flex items-center gap-3 text-[11px] min-w-[140px] justify-end">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={required}
                                disabled={!canEdit}
                                aria-label={`Require ${f.label}`}
                                onChange={(e) => handleToggleCustomFieldRequired(f.key, e.target.checked)}
                                className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                              />
                              Required
                            </label>
                            {canEdit && (
                              <button
                                type="button"
                                title={`Remove ${f.label}`}
                                onClick={() => handleRemoveCustomField(f.key)}
                                className="p-1 rounded text-rose-500 hover:bg-rose-500/10"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-4 text-[11px] min-w-[140px] justify-end">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={!hidden}
                                disabled={!canEdit}
                                aria-label={`Show ${f.label}`}
                                onChange={(e) => setFlag(f.key, 'hidden', !e.target.checked, !!f.required)}
                                className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                              />
                              Show
                            </label>
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={required}
                                disabled={!canEdit || hidden}
                                aria-label={`Require ${f.label}`}
                                onChange={(e) => setFlag(f.key, 'required', e.target.checked, !!f.required)}
                                className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
                              />
                              Required
                            </label>
                          </div>
                        )}
                      </div>

                      {isSelect && isEditingOptions && canEdit && !hidden && effectiveOptions && (
                        <InlineSelectOptionsEditor
                          fieldLabel={f.label}
                          options={effectiveOptions}
                          builtInOptions={f.custom ? undefined : f.options}
                          hasCustomOptions={hasCustomOptions}
                          onChange={(next) => setSelectOptions(f, next)}
                          onClose={() => setEditingOptionsFieldKey(null)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Inline New Field Builder inside this section */}
              {canEdit && addingFieldInSection === s.key && (
                <InlineAddFieldForm
                  sectionKey={s.key}
                  existingKeys={new Set(allFields(mergedForm).map((f) => f.key))}
                  onAdd={handleAddCustomField}
                  onCancel={() => setAddingFieldInSection(null)}
                />
              )}
            </FormSection>
          ))}

          {canEdit && (
            <FormFooter
              secondary={
                <SecondaryButton
                  icon={RotateCcw}
                  disabled={
                    Object.keys(draftOverrides).length === 0 &&
                    (draftCustom.sections?.length ?? 0) === 0 &&
                    (draftCustom.fields?.length ?? 0) === 0
                  }
                  onClick={() => {
                    setDraftOverrides({});
                    setDraftCustom(draftCustom.baseTemplate ? { baseTemplate: draftCustom.baseTemplate } : {});
                    setSaved(false);
                  }}
                >
                  Reset to Default
                </SecondaryButton>
              }
            >
              {saved && !formDirty && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <CheckCircle2 className="w-4 h-4" /> Saved
                </span>
              )}
              <PrimaryButton icon={Save} busy={busy} disabled={!formDirty} onClick={() => void saveFormChanges()}>
                Save Form Changes
              </PrimaryButton>
            </FormFooter>
          )}
        </>
      ) : (
        <Preview category={cat.category} form={previewForm} unsaved={formDirty} canCheck={canEdit} />
      )}
    </FormPanel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Type-Aware Inline Default Value Editor
// ─────────────────────────────────────────────────────────────────────────────

function DefaultValueInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: Pick<RequestFieldDef, 'type' | 'options' | 'label'>;
  value: RequestValue | undefined;
  disabled?: boolean;
  onChange: (val: RequestValue | undefined) => void;
}) {
  if (field.type === 'toggle') {
    const strVal = value === true ? 'true' : value === false ? 'false' : '';
    return (
      <SelectInput
        value={strVal}
        disabled={disabled}
        aria-label={`Default value for ${field.label}`}
        className="!py-1 !text-[11px]"
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === 'true' ? true : v === 'false' ? false : undefined);
        }}
      >
        <option value="">Default: None</option>
        <option value="true">Default: Checked (Yes)</option>
        <option value="false">Default: Unchecked (No)</option>
      </SelectInput>
    );
  }

  if (field.type === 'select') {
    return (
      <SelectInput
        value={value === undefined ? '' : String(value)}
        disabled={disabled}
        aria-label={`Default value for ${field.label}`}
        className="!py-1 !text-[11px]"
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">Default: None</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            Default: {opt}
          </option>
        ))}
      </SelectInput>
    );
  }

  return (
    <TextInput
      type={field.type === 'textarea' ? 'text' : field.type}
      value={value === undefined ? '' : String(value)}
      disabled={disabled}
      placeholder="Default value…"
      aria-label={`Default value for ${field.label}`}
      className="!py-1 !text-[11px]"
      onChange={(e) => {
        const raw = e.target.value;
        if (!raw) {
          onChange(undefined);
        } else if (field.type === 'number') {
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        } else {
          onChange(raw);
        }
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Dropdown Field Values Editor (for built-in & custom select fields)
// ─────────────────────────────────────────────────────────────────────────────

function InlineSelectOptionsEditor({
  fieldLabel,
  options,
  builtInOptions,
  hasCustomOptions,
  onChange,
  onClose,
}: {
  fieldLabel: string;
  options: string[];
  builtInOptions?: string[];
  hasCustomOptions: boolean;
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const [draftVal, setDraftVal] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const addValue = () => {
    const cleaned = draftVal.trim();
    if (!cleaned) return;
    if (cleaned.length > 80) {
      setErr('Each option must be 80 characters or fewer.');
      return;
    }
    if (options.some((o) => o.toLowerCase() === cleaned.toLowerCase())) {
      setErr(`"${cleaned}" is already in the list.`);
      return;
    }
    if (options.length >= 50) {
      setErr('Maximum of 50 dropdown options reached.');
      return;
    }
    setErr(null);
    onChange([...options, cleaned]);
    setDraftVal('');
  };

  const removeAt = (idx: number) => {
    if (options.length <= 1) {
      setErr('A dropdown field must keep at least 1 option.');
      return;
    }
    setErr(null);
    onChange(options.filter((_, i) => i !== idx));
  };

  const moveAt = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          <ListPlus className="w-3.5 h-3.5" />
          Dropdown Values for {fieldLabel} ({options.length})
        </p>
        <div className="flex items-center gap-2">
          {builtInOptions && hasCustomOptions && (
            <button
              type="button"
              onClick={() => {
                setErr(null);
                onChange([...builtInOptions]);
              }}
              className="text-[10px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)] underline"
            >
              Reset built-in values
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)]"
          >
            Done
          </button>
        </div>
      </div>

      {/* Existing Option Pills */}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt, idx) => (
          <span
            key={opt}
            className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] font-medium"
          >
            <span>{opt}</span>
            {options.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={idx === 0}
                  title="Move left"
                  aria-label={`Move ${opt} earlier`}
                  onClick={() => moveAt(idx, -1)}
                  className="p-0.5 rounded hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 text-[var(--text-muted)]"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={idx === options.length - 1}
                  title="Move right"
                  aria-label={`Move ${opt} later`}
                  onClick={() => moveAt(idx, 1)}
                  className="p-0.5 rounded hover:bg-[var(--bg-surface-hover)] disabled:opacity-30 text-[var(--text-muted)]"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title={`Remove ${opt}`}
                  aria-label={`Remove ${opt}`}
                  onClick={() => removeAt(idx)}
                  className="p-0.5 rounded hover:bg-rose-500/15 text-rose-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </>
            )}
          </span>
        ))}
      </div>

      {/* Add New Value Row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
        <TextInput
          value={draftVal}
          onChange={(e) => {
            setDraftVal(e.target.value);
            if (err) setErr(null);
          }}
          placeholder={`Add new value for ${fieldLabel} (e.g. Apple Pay, PO Invoice)…`}
          aria-label={`New dropdown value for ${fieldLabel}`}
          className="!py-1.5 !text-xs flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addValue();
            }
          }}
        />
        <PrimaryButton
          type="button"
          icon={Plus}
          disabled={!draftVal.trim()}
          onClick={addValue}
          className="!py-1.5 !text-xs shrink-0"
        >
          Add Value
        </PrimaryButton>
      </div>

      {err && <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">{err}</p>}

      <p className="text-[10px] text-[var(--text-muted)]">
        New values appear immediately in the <strong>Default:</strong> selector above and Live Preview. Click{' '}
        <strong>Save Form Changes</strong> below to publish to both portals.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline Add Field Builder (inside any section)
// ─────────────────────────────────────────────────────────────────────────────

function InlineAddFieldForm({
  sectionKey,
  existingKeys,
  onAdd,
  onCancel,
}: {
  sectionKey: string;
  existingKeys: Set<string>;
  onAdd: (field: CustomFieldDef) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [type, setType] = useState<RequestFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [placeholder, setPlaceholder] = useState('');
  const [hint, setHint] = useState('');
  const [unit, setUnit] = useState('');
  const [required, setRequired] = useState(false);
  const [half, setHalf] = useState(true);
  const [defaultValue, setDefaultValue] = useState<RequestValue | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  const parsedOptions = useMemo(
    () => [...new Set(optionsText.split(',').map((o) => o.trim()).filter(Boolean))],
    [optionsText]
  );

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!keyEdited) setKey(slugifyFieldKey(v));
  };

  const submit = () => {
    setErr(null);
    const cleanLabel = label.trim();
    const cleanKey = (key.trim() || slugifyFieldKey(cleanLabel));
    if (!cleanLabel) {
      setErr('Field label is required.');
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,47}$/.test(cleanKey)) {
      setErr('Field key must start with a letter and use only letters, digits, or underscores.');
      return;
    }
    if (existingKeys.has(cleanKey)) {
      setErr(`Field key "${cleanKey}" already exists in this form. Pick a unique key.`);
      return;
    }
    if (type === 'select' && parsedOptions.length === 0) {
      setErr('Enter at least one comma-separated option for a dropdown field.');
      return;
    }
    const cleanDefault =
      type === 'select' && typeof defaultValue === 'string' && !parsedOptions.includes(defaultValue)
        ? undefined
        : defaultValue;

    onAdd({
      sectionKey,
      key: cleanKey,
      label: cleanLabel,
      type,
      custom: true,
      ...(type === 'select' ? { options: parsedOptions } : {}),
      ...(placeholder.trim() ? { placeholder: placeholder.trim() } : {}),
      ...(hint.trim() ? { hint: hint.trim() } : {}),
      ...(type === 'number' && unit.trim() ? { unit: unit.trim() } : {}),
      ...(required ? { required: true } : {}),
      ...(half && type !== 'textarea' && type !== 'toggle' ? { half: true } : {}),
      ...(cleanDefault !== undefined && cleanDefault !== '' ? { defaultValue: cleanDefault } : {}),
    });
  };

  return (
    <div className="mt-3 rounded-xl border border-blue-500/35 bg-blue-500/5 p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> New Custom Field
        </p>
        <button type="button" onClick={onCancel} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">
          <X className="w-4 h-4" />
        </button>
      </div>
      {err && <FormAlert>{err}</FormAlert>}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="Field Label" required>
          <TextInput
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="e.g. Gate Pass Number"
            maxLength={100}
          />
        </FormField>
        <FormField label="Field Key">
          <TextInput
            value={key}
            onChange={(e) => { setKeyEdited(true); setKey(e.target.value); }}
            placeholder="e.g. gatePassNo"
            maxLength={48}
          />
        </FormField>
        <FormField label="Field Type">
          <SelectInput
            value={type}
            onChange={(e) => {
              setType(e.target.value as RequestFieldType);
              setDefaultValue(undefined);
            }}
          >
            {REQUEST_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectInput>
        </FormField>

        {type === 'select' && (
          <FormField label="Dropdown Options (comma-separated)" required span="full">
            <TextInput
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder="e.g. Gate A, Gate B, VIP Lounge, Cargo Terminal"
            />
          </FormField>
        )}

        <FormField label="Default Value (optional)">
          <DefaultValueInput
            field={{ type, options: parsedOptions, label: label || 'New field' }}
            value={defaultValue}
            onChange={setDefaultValue}
          />
        </FormField>

        <FormField label="Placeholder">
          <TextInput
            value={placeholder}
            onChange={(e) => setPlaceholder(e.target.value)}
            placeholder="Optional input hint…"
            maxLength={140}
          />
        </FormField>

        {type === 'number' ? (
          <FormField label="Unit Suffix">
            <TextInput
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. kg, hrs, km"
              maxLength={24}
            />
          </FormField>
        ) : (
          <FormField label="Helper Text">
            <TextInput
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Shown below the field"
              maxLength={200}
            />
          </FormField>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-4 text-xs">
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
            />
            Required field
          </label>
          {type !== 'textarea' && type !== 'toggle' && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={half}
                onChange={(e) => setHalf(e.target.checked)}
                className="rounded border-[var(--border-subtle)] text-blue-600 focus:ring-0"
              />
              Half width (2-column)
            </label>
          )}
        </div>
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton icon={Plus} onClick={submit}>
            Add Field to Section
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Custom Category Modal
// ─────────────────────────────────────────────────────────────────────────────

function CreateCategoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (cat: TenantCategory) => void;
}) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [codeEdited, setCodeEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('🚐');
  const [badge, setBadge] = useState('');
  const [accent, setAccent] = useState<CategoryAccent>('cyan');
  const [moduleKey, setModuleKey] = useState('');
  const [template, setTemplate] = useState<CustomCategoryTemplate>('BLANK');
  const [enabled, setEnabled] = useState(true);
  const [bookingPortalEnabled, setBookingPortalEnabled] = useState(true);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleTitleChange = (v: string) => {
    setTitle(v);
    if (!codeEdited) setCode(normalizeCategoryCode(v));
  };

  const submit = async () => {
    setErr(null);
    if (title.trim().length < 2) {
      setErr('Enter a category title (at least 2 characters).');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/customers/transport-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          title: title.trim(),
          category: code.trim() || normalizeCategoryCode(title),
          description: description.trim() || undefined,
          icon,
          badge: badge.trim() || undefined,
          accent,
          moduleKey,
          template,
          enabled,
          bookingPortalEnabled,
          approvalRequired,
        }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok) {
        setErr(d?.error ?? 'Could not create category');
        return;
      }
      onCreated(d.category);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Add Transport Category"
    >
      <div className="w-full max-w-2xl my-8">
        <FormPanel
          title="Add Custom Transport Category"
          subtitle="Create a tenant-specific category wired to both Internal Booking Portal and Customer Portal"
          icon={Plus}
          actions={<SecondaryButton icon={X} onClick={onClose}>Close</SecondaryButton>}
        >
          {err && <FormAlert>{err}</FormAlert>}

          <FormSection title="Category Identity & Module Mapping" columns={2}>
            <FormField label="Category Title" required>
              <TextInput
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. VIP Airport Concierge"
                maxLength={60}
                autoFocus
              />
            </FormField>
            <FormField label="Category Code (auto-generated)" hint="Uppercase letters, digits, underscores">
              <TextInput
                value={code}
                onChange={(e) => { setCodeEdited(true); setCode(normalizeCategoryCode(e.target.value)); }}
                placeholder="VIP_AIRPORT_CONCIERGE"
                maxLength={48}
              />
            </FormField>
            <FormField label="Description" span="full">
              <TextInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short subtitle shown on Booking Portal and Customer Portal cards"
                maxLength={200}
              />
            </FormField>
            <FormField label="Starter Form Template">
              <SelectInput value={template} onChange={(e) => setTemplate(e.target.value as CustomCategoryTemplate)}>
                {CUSTOM_CATEGORY_TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Linked Module Gate (SERVICE_MODULE_MAP)">
              <SelectInput value={moduleKey} onChange={(e) => setModuleKey(e.target.value)}>
                {LINKABLE_MODULES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Accent Color">
              <SelectInput value={accent} onChange={(e) => setAccent(e.target.value as CategoryAccent)}>
                {CATEGORY_ACCENTS.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </SelectInput>
            </FormField>
            <FormField label="Badge Tag (optional)">
              <TextInput
                value={badge}
                onChange={(e) => setBadge(e.target.value.toUpperCase())}
                placeholder="e.g. CONCIERGE"
                maxLength={16}
              />
            </FormField>
            <FormField label="Icon" span="full">
              <div className="flex flex-wrap gap-1.5">
                {ICON_CHOICES.map((ic) => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setIcon(ic)}
                    className={`w-9 h-9 rounded-lg border text-lg flex items-center justify-center transition-colors ${
                      icon === ic
                        ? 'border-blue-500 bg-blue-500/15'
                        : 'border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)]'
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            </FormField>
          </FormSection>

          <div className="flex flex-wrap gap-5 px-1">
            <CheckboxField label="Offer in Customer Portal" checked={enabled} onChange={setEnabled} />
            <CheckboxField label="Show in Internal Booking Portal" checked={bookingPortalEnabled} onChange={setBookingPortalEnabled} />
            <CheckboxField label="Require approval" checked={approvalRequired} onChange={setApprovalRequired} />
          </div>

          <FormFooter secondary={<SecondaryButton onClick={onClose}>Cancel</SecondaryButton>}>
            <PrimaryButton icon={Plus} busy={busy} onClick={() => void submit()}>
              Create Category
            </PrimaryButton>
          </FormFooter>
        </FormPanel>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live Preview Tab (pre-populated with configured default values)
// ─────────────────────────────────────────────────────────────────────────────

function Preview({
  category,
  form,
  unsaved,
  canCheck,
}: {
  category: string;
  form: RequestFormDef;
  unsaved: boolean;
  canCheck: boolean;
}) {
  const defaults = useMemo(() => extractDefaultValues(form), [form]);
  const [values, setValues] = useState<RequestValues>(defaults);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    setValues((prev) => ({ ...defaults, ...prev }));
  }, [defaults]);

  const check = async () => {
    setResult(null);
    if (unsaved || !canCheck) {
      const local = validateRequestValues(form, values);
      setErrors(local.errors);
      setResult(
        local.ok
          ? 'Valid against your unsaved draft (save changes to publish).'
          : `${Object.keys(local.errors).length} field(s) need attention.`
      );
      return;
    }
    const res = await fetch('/api/customers/transport-catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, values }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok || !d?.ok) {
      setResult(d?.error ?? 'Could not check');
      return;
    }
    setErrors(d.errors ?? {});
    setResult(
      d.valid
        ? 'Valid — this entry would be accepted by the server.'
        : `${Object.keys(d.errors ?? {}).length} field(s) need attention.`
    );
  };

  return (
    <div className="space-y-4">
      {unsaved && (
        <FormAlert tone="info">
          Previewing unsaved changes (including custom sections, fields, and default values). Save changes to apply them live.
        </FormAlert>
      )}
      {result && <FormAlert tone={Object.keys(errors).length ? 'warning' : 'info'}>{result}</FormAlert>}
      <DynamicRequestForm
        form={form}
        values={values}
        errors={errors}
        onChange={(k, v) => {
          setValues((s) => ({ ...s, [k]: v }));
          setErrors((e) => {
            if (!(k in e)) return e;
            const n = { ...e };
            delete n[k];
            return n;
          });
        }}
      />
      <FormFooter
        secondary={
          <SecondaryButton
            icon={RotateCcw}
            onClick={() => {
              setValues(defaults);
              setErrors({});
              setResult(null);
            }}
          >
            Reset to Configured Defaults
          </SecondaryButton>
        }
      >
        <PrimaryButton icon={CheckCircle2} onClick={() => void check()}>
          Check Sample Entry
        </PrimaryButton>
      </FormFooter>
    </div>
  );
}

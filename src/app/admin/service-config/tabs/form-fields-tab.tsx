'use client';

/**
 * Tab 9 — Form Fields.
 *
 * Per-service request-form schema. Lets admins add, edit, reorder and
 * remove fields without a code release. Each field is a FormFieldDef:
 * key, label, type (text / textarea / select / number / date / datetime /
 * checkbox), required, placeholder, min/max (number), options (select),
 * preview + display (controls whether the value appears as a chip on
 * the ticket card).
 *
 * Stored as service_rules.formFields = { fields: FormFieldDef[] }.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff,
  CheckSquare, Square, X, Layers, Wand2, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, Select, SaveBar, Section, type RuleTabProps } from './shared';
import {
  DEFAULT_FORM_FIELDS_RULES, type FormFieldsRules, type FormFieldDef,
} from '@/types/service-rules';

const FIELD_TYPES = ['text', 'textarea', 'select', 'number', 'date', 'datetime', 'checkbox'] as const;
type FieldType = typeof FIELD_TYPES[number];

const DISPLAY_OPTIONS = ['text', 'badge'] as const;
type FieldIssue = { severity: 'error' | 'warning' | 'info'; message: string; detail?: string };

// ── Phase B+ — bindings catalogue ──────────────────────────────────────────
// Sources mirror FieldSource in src/types/service-tickets.ts. Each entry is
// exposed as a dropdown option so admins can pick one without typing the
// magic string. Adding a new source here AND in field-resolver.ts keeps the
// UI and engine in sync.
const FIELD_SOURCES: { value: NonNullable<FormFieldDef['source']>; label: string; help?: string }[] = [
  { value: 'user-input',                    label: 'User input',                         help: 'User types the value (default)' },
  { value: 'currentUser.name',              label: 'Current user — name',                help: 'Display name of the logged-in user' },
  { value: 'currentUser.email',             label: 'Current user — email' },
  { value: 'currentUser.id',                label: 'Current user — ID' },
  { value: 'currentUser.department',        label: 'Current user — department' },
  { value: 'currentUser.role',              label: 'Current user — role code' },
  { value: 'currentDate',                   label: 'Current date',                       help: 'YYYY-MM-DD at submit time' },
  { value: 'currentTimestamp',              label: 'Current timestamp',                  help: 'ISO 8601 at submit time' },
  { value: 'tenant.name',                   label: 'Tenant — name' },
  { value: 'tenant.id',                     label: 'Tenant — ID' },
  { value: 'vehicle.licensePlate',          label: 'Selected vehicle — plate',           help: 'From the vehicle dropdown on the form' },
  { value: 'vehicle.type',                  label: 'Selected vehicle — type' },
  { value: 'vehicle.id',                    label: 'Selected vehicle — ID' },
  { value: 'vehicle.lastOdometer',          label: 'Selected vehicle — last odometer' },
  { value: 'maintenanceType.name',          label: 'Selected maintenance type — name' },
  { value: 'maintenanceType.code',          label: 'Selected maintenance type — code' },
  { value: 'maintenanceType.defaultPriority', label: 'Selected maintenance type — default priority' },
  { value: 'maintenanceType.estimatedHours',  label: 'Selected maintenance type — estimated hours' },
];

// Binding targets mirror FieldBindTarget. 'customFields' (default) keeps
// the value in the JSONB blob; named columns route the value to a real
// column on service_tickets.
const FIELD_BIND_TARGETS: { value: NonNullable<FormFieldDef['bindTo']>; label: string; help?: string }[] = [
  { value: 'customFields',     label: 'Custom Fields (JSONB)',  help: 'Default — stored under the field key in the JSONB blob' },
  { value: 'requestorName',    label: 'Requestor Name (column)' },
  { value: 'requestorId',      label: 'Requestor ID (column)' },
  { value: 'assignedTo',       label: 'Assigned To (column)' },
  { value: 'priority',         label: 'Priority (column)' },
  { value: 'dueDate',          label: 'Due Date (column)' },
  { value: 'vehicleId',        label: 'Vehicle ID (column)' },
  { value: 'relatedDriverId',  label: 'Related Driver ID (column)' },
];

function newField(): FormFieldDef {
  return {
    key: `new_field_${Math.random().toString(36).slice(2, 8)}`,
    label: 'New field',
    type: 'text',
    required: false,
  };
}

export function FormFieldsTab({ typeId, scopeId, scopeLookup, linkedModule }: RuleTabProps) {
  const { rules, patch, loading, saving, savedMsg, error, configured, ownedScope, save, reload } =
    useRuleTab<FormFieldsRules>(typeId, 'formFields', DEFAULT_FORM_FIELDS_RULES, scopeId);

  // Track which field card is expanded for editing — collapsed by default.
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // Phase B++ — fetch the module field catalogue when Module Mapping has
  // a linkedModule. The catalogue drives:
  //   • The Sync banner above the field list
  //   • Module-aware entries in the bind-to dropdown
  //   • The "+ Sync from module catalog" picker
  const [moduleFields, setModuleFields] = useState<ModuleFieldEntry[]>([]);
  const [syncOpen,     setSyncOpen]     = useState(false);
  useEffect(() => {
    if (!linkedModule) { setModuleFields([]); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/data-masters/module-fields?module=${linkedModule}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setModuleFields(data.fields ?? []);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [linkedModule]);

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(DEFAULT_FORM_FIELDS_RULES) || configured,
    [rules, configured],
  );

  // Count of module fields not yet in the form — drives the banner CTA.
  // Must live above the early-return so the hook order stays stable across
  // loading transitions.
  const unaddedModuleFields = useMemo(() => {
    if (moduleFields.length === 0) return 0;
    const existing = new Set(rules.fields.map(f => f.key));
    return moduleFields.filter(m => !existing.has(m.key)).length;
  }, [moduleFields, rules.fields]);

  const fieldIssues = useMemo<FieldIssue[]>(() => {
    const issues: FieldIssue[] = [];
    const seen = new Map<string, number>();
    const columnBindings = new Map<string, number>();
    for (const field of rules.fields) {
      const key = field.key.trim();
      if (!key) issues.push({ severity: 'error', message: 'A field has a blank key.', detail: field.label || 'Untitled field' });
      if (!field.label.trim()) issues.push({ severity: 'warning', message: `Field "${field.key || 'untitled'}" has a blank label.` });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        issues.push({ severity: 'error', message: `Select field "${field.label}" has no options.` });
      }
      if (field.type === 'number' && field.min != null && field.max != null && field.min > field.max) {
        issues.push({ severity: 'error', message: `Number field "${field.label}" has min greater than max.` });
      }
      if (field.required && field.readOnly && (!field.source || field.source === 'user-input')) {
        issues.push({ severity: 'error', message: `Required read-only field "${field.label}" has no automatic source.` });
      }
      if (field.bindTo?.startsWith('module.') && !linkedModule) {
        issues.push({ severity: 'warning', message: `Field "${field.label}" is bound to a module field but no linked module is selected.` });
      }
      if (field.bindTo && field.bindTo !== 'customFields' && !field.bindTo.startsWith('module.')) {
        columnBindings.set(field.bindTo, (columnBindings.get(field.bindTo) ?? 0) + 1);
      }
    }
    for (const [key, count] of seen.entries()) {
      if (key && count > 1) issues.push({ severity: 'error', message: `Duplicate field key "${key}" appears ${count} times.` });
    }
    for (const [target, count] of columnBindings.entries()) {
      if (count > 1) issues.push({ severity: 'warning', message: `${count} fields write to ticket column "${target}".`, detail: 'Only one value should own a top-level ticket column.' });
    }
    const previewCount = rules.fields.filter(f => f.preview && !f.hidden).length;
    if (previewCount > 2) {
      issues.push({ severity: 'info', message: `${previewCount} fields are marked for card preview.`, detail: 'Ticket cards work best with one or two preview chips.' });
    }
    if (issues.length === 0 && rules.fields.length > 0) {
      issues.push({ severity: 'info', message: 'Schema checks passed for the current form fields.' });
    }
    return issues;
  }, [linkedModule, rules.fields]);

  const previewFields = useMemo(
    () => rules.fields.filter(f => !f.hidden).slice(0, 6),
    [rules.fields],
  );

  if (loading) return <div className="text-sm text-slate-500">Loading…</div>;

  const addField = () => {
    const next = [...rules.fields, newField()];
    patch({ fields: next });
    setOpenIdx(next.length - 1);
  };

  const updateField = (i: number, p: Partial<FormFieldDef>) => {
    patch({ fields: rules.fields.map((f, idx) => idx === i ? { ...f, ...p } : f) });
  };

  const removeField = (i: number) => {
    if (!window.confirm(`Remove field "${rules.fields[i].label}"? Existing tickets keep their stored values.`)) return;
    patch({ fields: rules.fields.filter((_, idx) => idx !== i) });
    setOpenIdx(null);
  };

  const moveField = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= rules.fields.length) return;
    const next = [...rules.fields];
    [next[i], next[j]] = [next[j], next[i]];
    patch({ fields: next });
    if (openIdx === i) setOpenIdx(j);
  };

  // Phase B++ — bulk-add module catalogue fields. Idempotent: only adds
  // entries whose key isn't already present. Pre-fills bindTo / source /
  // readOnly from the catalogue's suggestions so the admin's first click
  // produces a working form.
  const addFromCatalog = (selectedKeys: string[]) => {
    const existingKeys = new Set(rules.fields.map(f => f.key));
    const additions: FormFieldDef[] = [];
    for (const m of moduleFields) {
      if (!selectedKeys.includes(m.key)) continue;
      if (existingKeys.has(m.key)) continue;
      additions.push({
        key:         m.key,
        label:       m.label,
        type:        m.suggestedType,
        required:    m.suggestedRequired,
        placeholder: m.description,
        source:      m.suggestedSource,
        bindTo:      `module.${m.key}`,
        readOnly:    !!m.suggestedSource && m.suggestedSource !== 'user-input',
      });
    }
    if (additions.length === 0) { setSyncOpen(false); return; }
    patch({ fields: [...rules.fields, ...additions] });
    setSyncOpen(false);
  };

  // Add a single field from the module catalogue — used by the inline
  // "Add from module" picker for one-click pre-mapped adds.
  const addFromModule = (catalogKey: string) => {
    const m = moduleFields.find(x => x.key === catalogKey);
    if (!m) return;
    if (rules.fields.some(f => f.key === m.key)) {
      // Already in form — open it for editing instead of duplicating.
      const idx = rules.fields.findIndex(f => f.key === m.key);
      setOpenIdx(idx);
      return;
    }
    const next: FormFieldDef[] = [...rules.fields, {
      key:         m.key,
      label:       m.label,
      type:        m.suggestedType,
      required:    m.suggestedRequired,
      placeholder: m.description,
      source:      m.suggestedSource,
      bindTo:      `module.${m.key}`,
      readOnly:    !!m.suggestedSource && m.suggestedSource !== 'user-input',
    }];
    patch({ fields: next });
    setOpenIdx(next.length - 1); // expand the freshly added card
  };

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Phase B++ — Module catalogue banner. Surfaces the linked module
          and a one-click "Sync from module catalog" entrypoint. Hidden
          when Module Mapping hasn't picked a module yet. */}
      {linkedModule && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-300 bg-blue-50 px-4 py-3">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-blue-100">
              Linked module: <strong>{prettyModuleName(linkedModule)}</strong>
            </p>
            <p className="mt-0.5 text-[11px] text-blue-700/80">
              {moduleFields.length === 0
                ? 'Loading module catalogue…'
                : unaddedModuleFields === 0
                  ? `All ${moduleFields.length} catalogue fields already in the form.`
                  : `${unaddedModuleFields} of ${moduleFields.length} catalogue fields not yet added. Sync them or pick individual fields below.`}
            </p>
          </div>
          {moduleFields.length > 0 && unaddedModuleFields > 0 && (
            <button type="button" onClick={() => setSyncOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-900 shadow-sm transition hover:bg-blue-200">
              <Wand2 className="w-3.5 h-3.5" /> Sync from module catalog
            </button>
          )}
        </div>
      )}

      <FormSchemaChecks issues={fieldIssues} previewFields={previewFields} />

      <Section title="Request form schema"
        hint="The fields shown when a user creates a ticket of this service. Field keys are stable identifiers — change them with care.">
        <div className="space-y-2">
          {rules.fields.length === 0 && (
            <div className="text-[12px] text-slate-500 bg-slate-800/40 border border-white/5 rounded-lg px-4 py-6 text-center">
              No fields yet. {linkedModule
                ? <>Add one or <button type="button" onClick={() => setSyncOpen(true)} className="text-violet-700 underline-offset-2 hover:text-violet-900 hover:underline">sync from {prettyModuleName(linkedModule)}</button>.</>
                : 'Add one to get started.'}
            </div>
          )}
          {rules.fields.map((field, i) => (
            <FieldCard key={i}
              field={field}
              index={i}
              total={rules.fields.length}
              moduleFields={moduleFields}
              linkedModule={linkedModule ?? null}
              open={openIdx === i}
              onToggleOpen={() => setOpenIdx(openIdx === i ? null : i)}
              onChange={p => updateField(i, p)}
              onRemove={() => removeField(i)}
              onMove={dir => moveField(i, dir)} />
          ))}
        </div>

        {/* Add-field row.
            • Custom field          → blank field (today's behaviour)
            • Map from module field → one-click pre-mapped field; the
              picker only shows catalogue entries not already in the form.
            The two buttons sit side-by-side so the user immediately sees
            both paths and doesn't have to discover the bindings panel. */}
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={addField}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-100 px-3 py-1.5 text-xs text-violet-900 shadow-sm transition hover:bg-violet-200">
            <Plus className="w-3.5 h-3.5" /> Add custom field
          </button>
          {linkedModule && moduleFields.length > 0 && (
            <AddFromModulePicker
              linkedModule={linkedModule}
              moduleFields={moduleFields}
              existingKeys={new Set(rules.fields.map(f => f.key))}
              onAdd={addFromModule} />
          )}
        </div>
      </Section>

      {syncOpen && linkedModule && (
        <SyncFromCatalogModal
          linkedModule={linkedModule}
          moduleFields={moduleFields}
          existingKeys={new Set(rules.fields.map(f => f.key))}
          onClose={() => setSyncOpen(false)}
          onConfirm={addFromCatalog} />
      )}

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload}
        typeId={typeId} category="formFields" scopeId={scopeId} ownedScope={ownedScope}
        scopeLookup={scopeLookup} onRolledBack={reload} />
    </div>
  );
}

// ── Phase B++ — module catalogue picker ────────────────────────────────────
// Modal that opens when the admin clicks "Sync from module catalog". Lists
// the catalogue fields with checkboxes; entries already in the form are
// pre-checked and disabled. Confirming adds only the new ones.

function FormSchemaChecks({ issues, previewFields }: {
  issues: FieldIssue[];
  previewFields: FormFieldDef[];
}) {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  return (
    <div className={`rounded-xl border px-4 py-3 ${
      errors > 0
        ? 'border-rose-500/30 bg-rose-500/5'
        : warnings > 0
          ? 'border-amber-500/30 bg-amber-500/5'
          : 'border-emerald-500/30 bg-emerald-500/5'
    }`}>
      <div className="flex items-start gap-3">
        {errors > 0 || warnings > 0
          ? <AlertCircle className={`w-4 h-4 mt-0.5 ${errors > 0 ? 'text-rose-300' : 'text-amber-300'}`} />
          : <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300" />}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">Schema safety checks</p>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {errors} errors - {warnings} warnings
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_220px]">
            <div className="space-y-1">
              {issues.slice(0, 4).map((issue, idx) => (
                <div key={`${issue.message}-${idx}`} className="text-[11px] text-slate-300">
                  <span className={
                    issue.severity === 'error' ? 'text-rose-300' : issue.severity === 'warning' ? 'text-amber-300' : 'text-emerald-300'
                  }>
                    {issue.severity.toUpperCase()}
                  </span>
                  {' '}- {issue.message}
                  {issue.detail && <span className="text-slate-500"> {issue.detail}</span>}
                </div>
              ))}
              {issues.length > 4 && <p className="text-[11px] text-slate-500">+{issues.length - 4} more checks.</p>}
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/40 p-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Create-form preview</p>
              {previewFields.length === 0 ? (
                <p className="text-[11px] text-slate-500">No visible fields.</p>
              ) : (
                <div className="space-y-1">
                  {previewFields.map(field => (
                    <div key={field.key} className="flex items-center gap-2 text-[11px] text-slate-300">
                      <span className="truncate">{field.label || field.key}</span>
                      {field.required && <span className="text-rose-300">*</span>}
                      <span className="ml-auto text-slate-500">{field.type}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModuleFieldEntry {
  key: string;
  label: string;
  description: string;
  suggestedType: FormFieldDef['type'];
  suggestedRequired?: boolean;
  suggestedSource?: NonNullable<FormFieldDef['source']>;
  group: string;
}

function SyncFromCatalogModal({
  linkedModule, moduleFields, existingKeys, onClose, onConfirm,
}: {
  linkedModule: string;
  moduleFields: ModuleFieldEntry[];
  existingKeys: Set<string>;
  onClose: () => void;
  onConfirm: (keys: string[]) => void;
}) {
  // Pre-select every field that isn't already in the form so the default
  // path is "add everything I don't have".
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(moduleFields.filter(m => !existingKeys.has(m.key)).map(m => m.key))
  );
  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Group entries by their `group` so the modal reads like a catalogue.
  const grouped = useMemo(() => {
    const out: Record<string, ModuleFieldEntry[]> = {};
    for (const m of moduleFields) (out[m.group] ??= []).push(m);
    return out;
  }, [moduleFields]);

  const newCount = [...selected].filter(k => !existingKeys.has(k)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <Layers className="h-5 w-5 text-blue-700" />
          <h2 className="text-lg font-bold text-white">Sync fields from {prettyModuleName(linkedModule)}</h2>
          <button onClick={onClose} className="ml-auto p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-[12px] text-slate-400">
            Pre-checked fields are not in the form yet. Confirm to add them with sensible defaults
            (suggested type, source, and bindings to the module's downstream model). Existing fields
            are left untouched.
          </p>
          {Object.entries(grouped).map(([group, entries]) => (
            <div key={group} className="space-y-1">
              <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-1">{group}</h3>
              {entries.map(m => {
                const already = existingKeys.has(m.key);
                const checked = already || selected.has(m.key);
                return (
                  <label key={m.key}
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border cursor-pointer ${
                      already
                        ? 'bg-slate-800/30 border-white/5 opacity-60'
                        : checked
                          ? 'bg-blue-100 border-blue-300 shadow-sm'
                          : 'bg-slate-800/40 border-white/10 hover:border-white/20'
                    }`}>
                    <input type="checkbox" checked={checked} disabled={already}
                      onChange={() => toggle(m.key)}
                      className="mt-1 w-3.5 h-3.5 accent-blue-500 rounded" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white">{m.label}</span>
                        <span className="text-[10px] font-mono text-slate-500">{m.key}</span>
                        <span className="text-[10px] uppercase tracking-wider text-slate-500">{m.suggestedType}</span>
                        {m.suggestedRequired && <span className="text-[10px] text-rose-400">required</span>}
                        {already && <span className="text-[10px] text-emerald-400 inline-flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> in form</span>}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">{m.description}</p>
                      {m.suggestedSource && (
                        <p className="mt-0.5 text-[10px] font-mono text-violet-700">source: {m.suggestedSource}</p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-white/10">
          <button onClick={() => onConfirm([...selected].filter(k => !existingKeys.has(k)))}
            disabled={newCount === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            <Plus className="w-4 h-4" /> Add {newCount} field{newCount === 1 ? '' : 's'}
          </button>
          <button onClick={onClose} className="px-3 py-2 text-slate-400 hover:text-white text-sm">Cancel</button>
          <span className="ml-auto text-[11px] text-slate-500">
            {existingKeys.size > 0 && `${existingKeys.size} already in form`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Phase B++ — single-pick "Add from module" entrypoint ───────────────
// Sits next to "+ Add custom field" and gives admins a one-click path to
// drop in a single pre-mapped field from the linked module's catalogue.
// Handy when you only need ONE module field and the bulk Sync modal feels
// like overkill. Closed picker shows just a button; opening reveals a
// scrollable list grouped by section, with already-added entries dimmed.

function AddFromModulePicker({
  linkedModule, moduleFields, existingKeys, onAdd,
}: {
  linkedModule: string;
  moduleFields: ModuleFieldEntry[];
  existingKeys: Set<string>;
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on click-outside. Tracking with a single boolean keeps the
  // popover simple — no need for a portal or complex focus management.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-add-from-module]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Group catalogue entries by `group` for readability.
  const grouped = useMemo(() => {
    const out: Record<string, ModuleFieldEntry[]> = {};
    for (const m of moduleFields) (out[m.group] ??= []).push(m);
    return out;
  }, [moduleFields]);

  const unaddedCount = moduleFields.filter(m => !existingKeys.has(m.key)).length;

  return (
    <div className="relative" data-add-from-module>
      <button type="button" onClick={() => setOpen(v => !v)}
        disabled={unaddedCount === 0}
        title={unaddedCount === 0 ? 'All catalogue fields are already in the form' : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-100 px-3 py-1.5 text-xs text-blue-900 shadow-sm transition hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-40">
        <Layers className="w-3.5 h-3.5" /> Map from module field
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 max-h-80 overflow-y-auto z-20 bg-slate-900 border border-blue-500/30 rounded-lg shadow-2xl">
          <div className="px-3 py-2 border-b border-white/5 sticky top-0 bg-slate-900">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-100">
              {prettyModuleName(linkedModule)}
            </p>
            <p className="text-[10px] text-slate-500">Pick a field — pre-fills label, type, source, and binding.</p>
          </div>
          {Object.entries(grouped).map(([group, entries]) => (
            <div key={group}>
              <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{group}</p>
              {entries.map(m => {
                const already = existingKeys.has(m.key);
                return (
                  <button key={m.key} type="button"
                    disabled={already}
                    onClick={() => { onAdd(m.key); setOpen(false); }}
                    className={`w-full text-left px-3 py-2 flex items-start gap-2 ${
                      already
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-blue-500/10'
                    }`}>
                    <Plus className={`mt-1 h-3 w-3 shrink-0 ${already ? 'opacity-0' : 'text-blue-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-white truncate">{m.label}</span>
                        <span className="text-[9px] uppercase tracking-wider text-slate-500">{m.suggestedType}</span>
                        {m.suggestedRequired && <span className="text-[9px] text-rose-400">required</span>}
                        {already && <span className="text-[9px] text-emerald-400">in form</span>}
                      </div>
                      <p className="text-[10px] text-slate-500 truncate" title={m.description}>{m.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// LinkedModule code → display label. Mirrors LINKED_MODULE_LABEL but
// inlined here to avoid importing into the client bundle.
function prettyModuleName(code: string): string {
  const labels: Record<string, string> = {
    SERVICE_TICKETING: 'Service & Support Ticketing',
    MAINTENANCE:       'Vehicle Maintenance',
    DRIVERS:           'Drivers',
    BOOKING:           'Booking & Dispatch',
    LEASING:           'Vehicle Leasing',
    RAC:               'Rent-a-Car',
    STAFF_TRANSPORT:   'Staff Transport',
    SCHOOL_BUS:        'School Bus',
    LOGISTICS:         'Logistics',
    INCIDENT:          'Incident / Ambulance',
    FINANCE:           'Finance',
    ADMIN:             'Platform Admin',
  };
  return labels[code] ?? code;
}

// ── Per-field editor card ───────────────────────────────────────────────────

function FieldCard({
  field, index, total, moduleFields, linkedModule, open, onToggleOpen, onChange, onRemove, onMove,
}: {
  field: FormFieldDef;
  index: number;
  total: number;
  /** Module catalogue for bind-to options (Phase B++). Empty when no
   *  module is linked. */
  moduleFields: ModuleFieldEntry[];
  linkedModule: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onChange: (p: Partial<FormFieldDef>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const isSelect = field.type === 'select';
  const isNumber = field.type === 'number';
  const isPreview = !!field.preview;

  return (
    <div className={`bg-slate-800/60 border rounded-lg overflow-hidden transition-colors ${
      open ? 'border-violet-500/40' : 'border-white/10 hover:border-white/20'
    }`}>
      {/* Compact header — click to expand */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggleOpen}
          className="flex-1 flex items-center gap-2 text-left">
          {field.required ? <CheckSquare className="w-3.5 h-3.5 text-rose-400" /> : <Square className="w-3.5 h-3.5 text-slate-500" />}
          <span className="text-sm font-semibold text-white">{field.label || '(no label)'}</span>
          <span className="text-[10px] font-mono text-slate-500">{field.key}</span>
          <span className="text-[10px] uppercase tracking-wider text-slate-400">{field.type}</span>
          {field.preview && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-700">
              <Eye className="w-3 h-3" /> preview
            </span>
          )}
        </button>
        <div className="flex items-center gap-0.5">
          <IconBtn onClick={() => onMove(-1)} disabled={index === 0} title="Move up"><ChevronUp className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn onClick={() => onMove(+1)} disabled={index === total - 1} title="Move down"><ChevronDown className="w-3.5 h-3.5" /></IconBtn>
          <IconBtn onClick={onRemove} title="Remove" tone="rose"><Trash2 className="w-3.5 h-3.5" /></IconBtn>
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div className="border-t border-white/5 p-3 space-y-3 bg-slate-950/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Label" required>
              <TextInput value={field.label}
                onChange={e => onChange({ label: e.target.value })}
                placeholder="What the user sees" />
            </Field>
            <Field label="Key" required hint="Stable identifier in stored data — avoid changing">
              <TextInput value={field.key}
                onChange={e => onChange({ key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '_') })}
                className="font-mono" />
            </Field>
            <Field label="Type" required>
              <Select value={field.type as FieldType}
                options={FIELD_TYPES}
                onChange={(t: FieldType) => {
                  // Strip type-specific keys when type changes.
                  const next: Partial<FormFieldDef> = { type: t };
                  if (t !== 'select') next.options = undefined;
                  if (t !== 'number') { next.min = undefined; next.max = undefined; }
                  onChange(next);
                }} />
            </Field>
            <Field label="Placeholder" hint="Optional hint text in the empty input">
              <TextInput value={field.placeholder ?? ''}
                onChange={e => onChange({ placeholder: e.target.value || undefined })} />
            </Field>
            {isNumber && (
              <>
                <Field label="Min">
                  <NumberInput value={field.min ?? null}
                    onChange={v => onChange({ min: v ?? undefined })} />
                </Field>
                <Field label="Max">
                  <NumberInput value={field.max ?? null}
                    onChange={v => onChange({ max: v ?? undefined })} />
                </Field>
              </>
            )}
          </div>

          {/* Toggles row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Toggle label="Required" hint="Block submission when empty"
              checked={!!field.required}
              onChange={v => onChange({ required: v })} />
            <Toggle label="Show on card preview" hint="Surface this field on the ticket card list"
              checked={isPreview}
              onChange={v => onChange({ preview: v, display: v ? (field.display ?? 'text') : undefined })} />
          </div>

          {/* ── Phase B+ — bindings panel ───────────────────────────────
              Collapsed by default; admins who don't need bindings see a
              clean field editor. Open it to wire a field to currentUser /
              vehicle / maintenance type, or to bind into a top-level
              column instead of customFields. Phase B++ — when a Module
              Mapping linkedModule is present, the bind-to dropdown also
              surfaces the module's catalogue fields. */}
          <BindingsPanel field={field} onChange={onChange}
            moduleFields={moduleFields}
            linkedModule={linkedModule} />

          {isPreview && (
            <Field label="Card display" hint="How the value appears on the ticket card">
              <div className="flex gap-1.5">
                {DISPLAY_OPTIONS.map(d => (
                  <button key={d} type="button" onClick={() => onChange({ display: d })}
                    className={`px-2.5 py-1 rounded-md text-[11px] border ${
                      (field.display ?? 'text') === d
                        ? 'bg-violet-100 text-violet-900 border-violet-300 shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 border-white/10'
                    }`}>
                    {d === 'text' ? <span>Text · "Label: value"</span> : <span>Badge · chip</span>}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {isSelect && (
            <Section title="Options" hint="Each option has a stable value (stored) and a label (shown).">
              <OptionsEditor
                options={field.options ?? []}
                onChange={opts => onChange({ options: opts })} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

// ── Select-options sub-editor ───────────────────────────────────────────────

function OptionsEditor({
  options, onChange,
}: {
  options: { value: string; label: string }[];
  onChange: (next: { value: string; label: string }[]) => void;
}) {
  const [draftValue, setDraftValue] = useState('');
  const [draftLabel, setDraftLabel] = useState('');

  const add = () => {
    const v = draftValue.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const l = draftLabel.trim();
    if (!v || !l) return;
    if (options.some(o => o.value === v)) return;
    onChange([...options, { value: v, label: l }]);
    setDraftValue(''); setDraftLabel('');
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {options.length === 0 && (
          <p className="text-[11px] text-slate-500">No options yet. Add the first below.</p>
        )}
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 bg-slate-900/60 border border-white/5 rounded px-2 py-1.5">
            <span className="text-[11px] font-mono text-slate-400 w-32 truncate" title={opt.value}>{opt.value}</span>
            <span className="text-slate-500">→</span>
            <input value={opt.label}
              onChange={e => onChange(options.map((o, idx) => idx === i ? { ...o, label: e.target.value } : o))}
              className="flex-1 bg-transparent text-xs text-white focus:outline-none" />
            <button type="button" onClick={() => onChange(options.filter((_, idx) => idx !== i))}
              className="p-0.5 rounded hover:bg-rose-500/20 text-rose-300">
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <input value={draftValue} onChange={e => setDraftValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="value (stored)"
          className="bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-violet-500" />
        <input value={draftLabel} onChange={e => setDraftLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="label (shown)"
          className="bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
        <button type="button" onClick={add}
          className="rounded border border-violet-300 bg-violet-100 px-3 text-violet-900 shadow-sm transition hover:bg-violet-200">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Phase B+ — Bindings panel ──────────────────────────────────────────────
// Renders inside each field-card. Lets admins declare:
//   • Source   — where the value comes from (user-input by default)
//   • Bind to  — where the value lands on the ticket (customFields JSONB
//                by default; named bindings hoist into top-level columns)
//   • Read-only — render but disable; pairs with non-default source
//   • Hidden   — don't render at all; pairs with non-default source

function BindingsPanel({
  field, onChange, moduleFields, linkedModule,
}: {
  field: FormFieldDef;
  onChange: (p: Partial<FormFieldDef>) => void;
  /** Phase B++ — module catalogue. Empty array when no module linked. */
  moduleFields: ModuleFieldEntry[];
  linkedModule: string | null;
}) {
  const [open, setOpen] = useState(false);

  const source = field.source ?? 'user-input';
  const bindTo = field.bindTo ?? 'customFields';
  const isAutoSourced = source !== 'user-input';
  const isCustomBind = bindTo !== 'customFields';
  const isModuleBind = bindTo.startsWith('module.');
  // Compact header summary so admins can see what's wired without expanding.
  const summary = (() => {
    const bits: string[] = [];
    if (isAutoSourced) bits.push(`source: ${prettySource(source)}`);
    if (isCustomBind)  bits.push(`→ ${prettyTarget(bindTo, moduleFields)}`);
    if (field.readOnly) bits.push('read-only');
    if (field.hidden)   bits.push('hidden');
    return bits.length === 0 ? 'User input → Custom Fields (default)' : bits.join(' · ');
  })();

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/40">
      <button type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left">
        <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Data binding</span>
        <span className="text-[11px] text-slate-500 truncate flex-1">{summary}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-white/5 p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Source" hint="Where does the value come from?">
              <select
                value={source}
                onChange={e => onChange({ source: e.target.value as NonNullable<FormFieldDef['source']> })}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                {FIELD_SOURCES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              {FIELD_SOURCES.find(s => s.value === source)?.help && (
                <p className="text-[10px] text-slate-500 mt-1">{FIELD_SOURCES.find(s => s.value === source)?.help}</p>
              )}
            </Field>
            <Field label="Bind to" hint="Where does the value land on the ticket?">
              <select
                value={bindTo}
                onChange={e => onChange({ bindTo: e.target.value as NonNullable<FormFieldDef['bindTo']> })}
                className="w-full bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
                {/* Universal column targets first */}
                <optgroup label="Service Ticket columns">
                  {FIELD_BIND_TARGETS.map(b => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </optgroup>
                {/* Module catalogue — only when Module Mapping has a
                    linkedModule and the catalogue resolved. */}
                {linkedModule && moduleFields.length > 0 && (
                  <optgroup label={`Module: ${prettyModuleName(linkedModule)}`}>
                    {moduleFields.map(m => (
                      <option key={`module.${m.key}`} value={`module.${m.key}`}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                {/* Catch-all so an existing module.* binding still
                    renders selected even if the catalogue hasn't loaded. */}
                {isModuleBind && !moduleFields.find(m => `module.${m.key}` === bindTo) && (
                  <option value={bindTo}>{bindTo}</option>
                )}
              </select>
              {(() => {
                const moduleField = isModuleBind
                  ? moduleFields.find(m => `module.${m.key}` === bindTo)
                  : null;
                if (moduleField) {
                  // When the field is bound to a module catalogue entry but
                  // the field's metadata (label / type / source / required)
                  // doesn't match the catalogue, offer a one-click "Apply
                  // module defaults" button. Skipped when everything
                  // already lines up so we don't spam the UI.
                  const drift =
                    field.label !== moduleField.label ||
                    field.type !== moduleField.suggestedType ||
                    (field.source ?? 'user-input') !== (moduleField.suggestedSource ?? 'user-input') ||
                    !!field.required !== !!moduleField.suggestedRequired;
                  return (
                    <>
                      <p className="mt-1 text-[10px] text-blue-700/80">{moduleField.description} — written to the linked module's downstream model when the bridge fires.</p>
                      {drift && (
                        <button type="button"
                          onClick={() => onChange({
                            label:    moduleField.label,
                            type:     moduleField.suggestedType,
                            required: moduleField.suggestedRequired,
                            source:   moduleField.suggestedSource,
                            placeholder: moduleField.description,
                            readOnly: !!moduleField.suggestedSource && moduleField.suggestedSource !== 'user-input',
                          })}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-900 shadow-sm transition hover:bg-blue-200">
                          <Wand2 className="w-3 h-3" /> Apply module defaults
                        </button>
                      )}
                    </>
                  );
                }
                const helpEntry = FIELD_BIND_TARGETS.find(b => b.value === bindTo);
                return helpEntry?.help
                  ? <p className="text-[10px] text-slate-500 mt-1">{helpEntry.help}</p>
                  : null;
              })()}
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Toggle label="Read-only"
              hint={isAutoSourced ? 'User sees the value but cannot change it' : 'Pair with a non-default source so the auto-fill is final'}
              checked={!!field.readOnly}
              onChange={v => onChange({ readOnly: v })} />
            <Toggle label="Hidden"
              hint="Don't render in the form UI — captures the value silently"
              checked={!!field.hidden}
              onChange={v => onChange({ hidden: v })} />
          </div>

          {/* Best-practice nudge — surfaces common foot-guns. */}
          {isAutoSourced && !field.readOnly && !field.hidden && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-200">
              Tip: when source is not user-input, mark the field <strong>read-only</strong> (or <strong>hidden</strong>) so the user can't accidentally overwrite the auto-fill — the server overwrites it on submit anyway, but read-only avoids confusion.
            </div>
          )}
          {!isAutoSourced && field.readOnly && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-200">
              Read-only with source = user-input means the user can never enter a value. Did you mean to pair this with a non-default source?
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function prettySource(s: NonNullable<FormFieldDef['source']>): string {
  return FIELD_SOURCES.find(x => x.value === s)?.label ?? s;
}
function prettyTarget(
  t: NonNullable<FormFieldDef['bindTo']>,
  moduleFields: ModuleFieldEntry[] = [],
): string {
  // Top-level columns first.
  const direct = FIELD_BIND_TARGETS.find(x => x.value === t);
  if (direct) return direct.label;
  // module.<key> bindings — look up in the catalogue.
  if (t.startsWith('module.')) {
    const key = t.slice('module.'.length);
    const m = moduleFields.find(x => x.key === key);
    return m ? `Module: ${m.label}` : t;
  }
  return t;
}

// ── Tiny icon button used in the field-card header ──────────────────────────

function IconBtn({
  children, onClick, disabled, title, tone = 'slate',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
  tone?: 'slate' | 'rose';
}) {
  const palette = tone === 'rose'
    ? 'text-rose-300 hover:bg-rose-500/15'
    : 'text-slate-400 hover:bg-white/10';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`p-1 rounded ${palette} disabled:opacity-30 disabled:pointer-events-none`}>
      {children}
    </button>
  );
}

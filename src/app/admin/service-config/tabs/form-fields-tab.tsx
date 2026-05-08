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

import { useMemo, useState } from 'react';
import {
  Plus, Trash2, ChevronUp, ChevronDown, Eye, EyeOff,
  CheckSquare, Square, X,
} from 'lucide-react';
import { useRuleTab } from './use-rule-tab';
import { Field, NumberInput, TextInput, Toggle, Select, SaveBar, Section } from './shared';
import {
  DEFAULT_FORM_FIELDS_RULES, type FormFieldsRules, type FormFieldDef,
} from '@/types/service-rules';

const FIELD_TYPES = ['text', 'textarea', 'select', 'number', 'date', 'datetime', 'checkbox'] as const;
type FieldType = typeof FIELD_TYPES[number];

const DISPLAY_OPTIONS = ['text', 'badge'] as const;

function newField(): FormFieldDef {
  return {
    key: `new_field_${Math.random().toString(36).slice(2, 8)}`,
    label: 'New field',
    type: 'text',
    required: false,
  };
}

export function FormFieldsTab({ typeId }: { typeId: string }) {
  const { rules, patch, loading, saving, savedMsg, error, configured, save, reload } =
    useRuleTab<FormFieldsRules>(typeId, 'formFields', DEFAULT_FORM_FIELDS_RULES);

  // Track which field card is expanded for editing — collapsed by default.
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(rules) !== JSON.stringify(DEFAULT_FORM_FIELDS_RULES) || configured,
    [rules, configured],
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

  return (
    <div className="space-y-5 max-w-3xl">
      <Section title="Request form schema"
        hint="The fields shown when a user creates a ticket of this service. Field keys are stable identifiers — change them with care.">
        <div className="space-y-2">
          {rules.fields.length === 0 && (
            <div className="text-[12px] text-slate-500 bg-slate-800/40 border border-white/5 rounded-lg px-4 py-6 text-center">
              No fields yet. Add one to get started.
            </div>
          )}
          {rules.fields.map((field, i) => (
            <FieldCard key={i}
              field={field}
              index={i}
              total={rules.fields.length}
              open={openIdx === i}
              onToggleOpen={() => setOpenIdx(openIdx === i ? null : i)}
              onChange={p => updateField(i, p)}
              onRemove={() => removeField(i)}
              onMove={dir => moveField(i, dir)} />
          ))}
        </div>

        <button type="button" onClick={addField}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs">
          <Plus className="w-3.5 h-3.5" /> Add field
        </button>
      </Section>

      <SaveBar configured={configured} dirty={dirty} saving={saving} error={error} savedMsg={savedMsg}
        onSave={save} onReset={reload} />
    </div>
  );
}

// ── Per-field editor card ───────────────────────────────────────────────────

function FieldCard({
  field, index, total, open, onToggleOpen, onChange, onRemove, onMove,
}: {
  field: FormFieldDef;
  index: number;
  total: number;
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
            <span className="text-[10px] text-violet-300 inline-flex items-center gap-0.5">
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

          {isPreview && (
            <Field label="Card display" hint="How the value appears on the ticket card">
              <div className="flex gap-1.5">
                {DISPLAY_OPTIONS.map(d => (
                  <button key={d} type="button" onClick={() => onChange({ display: d })}
                    className={`px-2.5 py-1 rounded-md text-[11px] border ${
                      (field.display ?? 'text') === d
                        ? 'bg-violet-500/20 text-violet-200 border-violet-500/40'
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
          className="px-3 rounded bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/40 text-violet-200">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
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

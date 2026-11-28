/**
 * Transport request forms as data.
 *
 * Each Transport category (Rent-a-Car, Logistics, … or tenant custom category)
 * has a form made of sections and fields. The default forms live in
 * ./default-forms.ts; a tenant can switch categories on/off, add custom
 * categories, add custom sections and fields into any section, hide fields,
 * change which are required, and configure default field values
 * (tenant_transport_categories.field_overrides & custom_form_config).
 *
 * The same definition drives both portals (Customer Portal DynamicRequestForm
 * and Internal Booking Portal) and server-side validation
 * (validateRequestValues), so a hidden, required, custom, or defaulted field
 * behaves identically everywhere.
 *
 * Browser-safe: no Node imports.
 */

export const REQUEST_FIELD_TYPES = [
  'text', 'email', 'tel', 'number', 'date', 'time', 'select', 'textarea', 'toggle',
] as const;

export type RequestFieldType = (typeof REQUEST_FIELD_TYPES)[number];

/** Show the field only when another field has a value (data form of the old showIf functions). */
export type ShowIf =
  | { field: string; truthy: boolean }
  | { field: string; equals: string }
  | { field: string; notEquals: string }
  | { field: string; in: string[] };

export type RequestValue = string | number | boolean;
export type RequestValues = Record<string, RequestValue>;

export interface RequestFieldDef {
  key: string;
  label: string;
  type: RequestFieldType;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  options?: string[];
  /** Half width in the two-column layout. */
  half?: boolean;
  /** Suffix shown after number inputs, e.g. "kg". */
  unit?: string;
  showIf?: ShowIf;
  /** Needed to route the request; a tenant cannot hide it or make it optional. */
  core?: boolean;
  /** Pre-populated value when opening a new form (configurable per tenant). */
  defaultValue?: RequestValue;
  /** True when added dynamically by a tenant admin. */
  custom?: boolean;
}

export interface RequestSectionDef {
  key: string;
  title: string;
  icon?: string;
  fields: RequestFieldDef[];
  /** True when added dynamically by a tenant admin. */
  custom?: boolean;
}

export interface RequestFormDef {
  sections: RequestSectionDef[];
}

/** A tenant's override to one field. */
export interface FieldOverride {
  hidden?: boolean;
  required?: boolean;
  defaultValue?: RequestValue;
  /** Custom dropdown values overriding the built-in list for `select` fields. */
  options?: string[];
}
export type FieldOverrides = Record<string, FieldOverride>;

/** A tenant-added custom section. */
export interface CustomSectionDef {
  key: string;
  title: string;
  icon?: string;
}

/** A tenant-added custom field targeting either a built-in or custom section. */
export interface CustomFieldDef extends RequestFieldDef {
  sectionKey: string;
  custom: true;
}

/** Stored in tenant_transport_categories.custom_form_config. */
export interface CustomFormConfig {
  /** For custom categories: starter template key ('BLANK' or a built-in TransportCategory). */
  baseTemplate?: string;
  sections?: CustomSectionDef[];
  fields?: CustomFieldDef[];
}

const SECTION_KEY_RE = /^[a-z][a-z0-9_]{1,47}$/;
const FIELD_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{1,47}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 200;
const MAX_TEXTAREA = 2000;
const MAX_SELECT_OPTIONS = 50;
const MAX_OPTION_LEN = 80;

/** Validates and normalizes dropdown options: trimmed, deduplicated, 1..50 non-empty items. */
export function cleanSelectOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' && typeof item !== 'number') return null;
    const trimmed = String(item).trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_OPTION_LEN) return null;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length > MAX_SELECT_OPTIONS) return null;
  }
  return out.length > 0 ? out : null;
}

/** Exact ordered equality check for two option lists. */
export function sameOptionsList(a?: readonly string[], b?: readonly string[]): boolean {
  if (!a && !b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function allFields(form: RequestFormDef): RequestFieldDef[] {
  return form.sections.flatMap((s) => s.fields);
}

/** Normalizes a label into a safe snake_case section key or camelCase field key. */
export function slugifySectionKey(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[0-9_]+/, '').replace(/_+$/, '');
  return (slug || 'custom_section').slice(0, 48);
}

export function slugifyFieldKey(label: string): string {
  const words = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'customField';
  const camel = words[0].replace(/^[0-9]+/, '') + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const clean = camel.replace(/[^a-zA-Z0-9_]/g, '');
  if (!clean || !/^[a-zA-Z]/.test(clean)) return `custom_${clean || 'field'}`.slice(0, 48);
  return clean.slice(0, 48);
}

/** Validates and normalizes a defaultValue against a field's type and options. */
export function cleanDefaultValue(
  field: Pick<RequestFieldDef, 'type' | 'options'>,
  raw: unknown,
): { ok: true; value: RequestValue | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };

  if (field.type === 'toggle') {
    if (raw === '') return { ok: true, value: undefined };
    if (typeof raw === 'boolean') return { ok: true, value: raw };
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false };
  }

  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : null;
  if (text === null) return { ok: false };
  if (text === '') return { ok: true, value: undefined };

  switch (field.type) {
    case 'number': {
      const n = Number(text);
      if (!Number.isFinite(n) || n < 0) return { ok: false };
      return { ok: true, value: n };
    }
    case 'email':
      if (!EMAIL_RE.test(text) || text.length > 254) return { ok: false };
      return { ok: true, value: text.toLowerCase() };
    case 'date':
      if (!DATE_RE.test(text) || Number.isNaN(Date.parse(text))) return { ok: false };
      return { ok: true, value: text };
    case 'time':
      if (!TIME_RE.test(text)) return { ok: false };
      return { ok: true, value: text };
    case 'select':
      if (!field.options?.includes(text)) return { ok: false };
      return { ok: true, value: text };
    case 'textarea':
      if (text.length > MAX_TEXTAREA) return { ok: false };
      return { ok: true, value: text };
    default:
      if (text.length > MAX_TEXT) return { ok: false };
      return { ok: true, value: text };
  }
}

function cleanShowIf(raw: unknown, knownFieldKeys: Set<string>): ShowIf | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.field !== 'string' || !knownFieldKeys.has(r.field)) return null;
  if ('truthy' in r && typeof r.truthy === 'boolean') return { field: r.field, truthy: r.truthy };
  if ('equals' in r && typeof r.equals === 'string') return { field: r.field, equals: r.equals };
  if ('notEquals' in r && typeof r.notEquals === 'string') return { field: r.field, notEquals: r.notEquals };
  if ('in' in r && Array.isArray(r.in) && r.in.every((x) => typeof x === 'string')) {
    return { field: r.field, in: r.in as string[] };
  }
  return null;
}

/**
 * Validates and normalizes tenant custom sections and fields.
 * Returns null if the payload is malformed.
 */
export function cleanCustomFormConfig(baseForm: RequestFormDef, raw: unknown): CustomFormConfig | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const baseSectionKeys = new Set(baseForm.sections.map((s) => s.key));
  const baseFieldKeys = new Set(allFields(baseForm).map((f) => f.key));

  const sections: CustomSectionDef[] = [];
  const customSectionKeys = new Set<string>();
  if (input.sections !== undefined) {
    if (!Array.isArray(input.sections) || input.sections.length > 20) return null;
    for (const item of input.sections) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rec = item as Record<string, unknown>;
      const key = typeof rec.key === 'string' ? rec.key.trim() : '';
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      if (!SECTION_KEY_RE.test(key) || !title || title.length > 80) return null;
      if (baseSectionKeys.has(key) || customSectionKeys.has(key)) return null;
      customSectionKeys.add(key);
      const icon = typeof rec.icon === 'string' && rec.icon.trim() ? rec.icon.trim().slice(0, 12) : undefined;
      sections.push({ key, title, ...(icon ? { icon } : {}) });
    }
  }

  const allSectionKeys = new Set([...baseSectionKeys, ...customSectionKeys]);
  const fields: CustomFieldDef[] = [];
  const customFieldKeys = new Set<string>();
  if (input.fields !== undefined) {
    if (!Array.isArray(input.fields) || input.fields.length > 80) return null;

    // Collect candidate keys first so showIf can reference sibling custom fields.
    const candidateKeys = new Set<string>(baseFieldKeys);
    for (const item of input.fields) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const k = typeof (item as Record<string, unknown>).key === 'string'
          ? String((item as Record<string, unknown>).key).trim()
          : '';
        if (FIELD_KEY_RE.test(k)) candidateKeys.add(k);
      }
    }

    for (const item of input.fields) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const rec = item as Record<string, unknown>;
      const key = typeof rec.key === 'string' ? rec.key.trim() : '';
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      const sectionKey = typeof rec.sectionKey === 'string' ? rec.sectionKey.trim() : '';
      const type = rec.type as RequestFieldType;

      if (!FIELD_KEY_RE.test(key) || !label || label.length > 100) return null;
      if (baseFieldKeys.has(key) || customFieldKeys.has(key)) return null;
      if (!REQUEST_FIELD_TYPES.includes(type)) return null;
      if (!allSectionKeys.has(sectionKey)) return null;

      let options: string[] | undefined;
      if (type === 'select') {
        const cleanedOpts = cleanSelectOptions(rec.options);
        if (!cleanedOpts) return null;
        options = cleanedOpts;
      }

      const defCheck = cleanDefaultValue({ type, options }, rec.defaultValue);
      if (!defCheck.ok) return null;

      const showIf = cleanShowIf(rec.showIf, candidateKeys);
      if (showIf === null) return null;

      customFieldKeys.add(key);
      const placeholder = typeof rec.placeholder === 'string' && rec.placeholder.trim()
        ? rec.placeholder.trim().slice(0, 140)
        : undefined;
      const hint = typeof rec.hint === 'string' && rec.hint.trim()
        ? rec.hint.trim().slice(0, 200)
        : undefined;
      const unit = typeof rec.unit === 'string' && rec.unit.trim()
        ? rec.unit.trim().slice(0, 24)
        : undefined;

      fields.push({
        sectionKey,
        key,
        label,
        type,
        custom: true,
        ...(options ? { options } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(hint ? { hint } : {}),
        ...(unit ? { unit } : {}),
        ...(rec.required === true ? { required: true } : {}),
        ...(rec.half === true ? { half: true } : {}),
        ...(defCheck.value !== undefined ? { defaultValue: defCheck.value } : {}),
        ...(showIf ? { showIf } : {}),
      });
    }
  }

  const out: CustomFormConfig = {};
  if (typeof input.baseTemplate === 'string' && /^[A-Z][A-Z0-9_]{1,47}$/.test(input.baseTemplate.trim())) {
    out.baseTemplate = input.baseTemplate.trim();
  }
  if (sections.length) out.sections = sections;
  if (fields.length) out.fields = fields;
  return out;
}

/** Merges tenant custom sections and custom fields into the base form without dropping hidden fields. */
export function mergeCustomForm(baseForm: RequestFormDef, customConfig?: CustomFormConfig | null): RequestFormDef {
  const sections: RequestSectionDef[] = baseForm.sections.map((s) => ({
    ...s,
    fields: [...s.fields],
  }));

  if (!customConfig) return { sections };

  const byKey = new Map<string, RequestSectionDef>(sections.map((s) => [s.key, s]));

  for (const cs of customConfig.sections ?? []) {
    if (!byKey.has(cs.key)) {
      const added: RequestSectionDef = {
        key: cs.key,
        title: cs.title,
        ...(cs.icon ? { icon: cs.icon } : {}),
        fields: [],
        custom: true,
      };
      sections.push(added);
      byKey.set(cs.key, added);
    }
  }

  for (const cf of customConfig.fields ?? []) {
    const target = byKey.get(cf.sectionKey);
    if (!target) continue;
    if (target.fields.some((f) => f.key === cf.key)) continue;
    const fieldDef: RequestFieldDef = {
      key: cf.key,
      label: cf.label,
      type: cf.type,
      custom: true,
      ...(cf.placeholder ? { placeholder: cf.placeholder } : {}),
      ...(cf.hint ? { hint: cf.hint } : {}),
      ...(cf.required ? { required: cf.required } : {}),
      ...(cf.options ? { options: cf.options } : {}),
      ...(cf.half ? { half: cf.half } : {}),
      ...(cf.unit ? { unit: cf.unit } : {}),
      ...(cf.showIf ? { showIf: cf.showIf } : {}),
      ...(cf.defaultValue !== undefined ? { defaultValue: cf.defaultValue } : {}),
    };
    target.fields.push(fieldDef);
  }

  return { sections };
}

/**
 * The form a tenant's users see: custom sections/fields merged in, hidden
 * fields removed, required flags, custom select options & defaultValues
 * applied. Core fields ignore hidden/required overrides (but accept options
 * and defaultValue overrides). Sections left empty are dropped.
 */
export function applyOverrides(
  form: RequestFormDef,
  overrides: FieldOverrides | null | undefined,
  customConfig?: CustomFormConfig | null,
): RequestFormDef {
  const merged = mergeCustomForm(form, customConfig);
  const o = overrides ?? {};
  return {
    sections: merged.sections
      .map((s) => ({
        ...s,
        fields: s.fields
          .filter((f) => f.core || !o[f.key]?.hidden)
          .map((f) => {
            const ov = o[f.key];
            if (!ov) return f;
            const nextRequired = f.core || ov.required === undefined ? f.required : ov.required;
            const nextOptions = f.type === 'select' && ov.options?.length ? ov.options : f.options;
            let nextDefault = ov.defaultValue !== undefined ? ov.defaultValue : f.defaultValue;
            if (
              f.type === 'select' &&
              typeof nextDefault === 'string' &&
              nextOptions &&
              !nextOptions.includes(nextDefault)
            ) {
              nextDefault = undefined;
            }
            const baseField = nextDefault === undefined && f.defaultValue !== undefined
              ? (() => {
                  const copy = { ...f };
                  delete copy.defaultValue;
                  return copy;
                })()
              : f;
            return {
              ...baseField,
              ...(nextOptions ? { options: nextOptions } : {}),
              ...(nextRequired !== undefined ? { required: nextRequired } : {}),
              ...(nextDefault !== undefined ? { defaultValue: nextDefault } : {}),
            };
          }),
      }))
      .filter((s) => s.fields.length > 0),
  };
}

/** Keeps only valid overrides for known fields (hidden/required ignored on core fields; options/defaultValue allowed on all). */
export function cleanOverrides(
  form: RequestFormDef,
  raw: unknown,
  customConfig?: CustomFormConfig | null,
): FieldOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const merged = mergeCustomForm(form, customConfig);
  const byKey = new Map(allFields(merged).map((f) => [f.key, f]));
  const out: FieldOverrides = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = byKey.get(key);
    if (!f || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    const { hidden, required, defaultValue, options } = v as Record<string, unknown>;
    if ((hidden !== undefined && typeof hidden !== 'boolean') || (required !== undefined && typeof required !== 'boolean')) {
      return null;
    }
    const entry: FieldOverride = {};
    if (!f.core) {
      if (hidden === true) entry.hidden = true;
      if (typeof required === 'boolean' && required !== !!f.required) entry.required = required;
    }
    if (options !== undefined) {
      if (f.type !== 'select') return null;
      const cleanedOpts = cleanSelectOptions(options);
      if (!cleanedOpts) return null;
      if (!sameOptionsList(cleanedOpts, f.options)) {
        entry.options = cleanedOpts;
      }
    }
    const effectiveOptions = entry.options ?? f.options;
    if (defaultValue !== undefined) {
      const defCheck = cleanDefaultValue({ type: f.type, options: effectiveOptions }, defaultValue);
      if (!defCheck.ok) return null;
      if (defCheck.value !== undefined && defCheck.value !== f.defaultValue) {
        entry.defaultValue = defCheck.value;
      }
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

/** Collects all configured defaultValue entries from an effective form. */
export function extractDefaultValues(form: RequestFormDef): RequestValues {
  const out: RequestValues = {};
  for (const f of allFields(form)) {
    if (f.defaultValue !== undefined && f.defaultValue !== '') {
      out[f.key] = f.defaultValue;
    }
  }
  return out;
}

export function isVisible(field: RequestFieldDef, values: RequestValues): boolean {
  const c = field.showIf;
  if (!c) return true;
  const v = values[c.field];
  if ('truthy' in c) return !!v === c.truthy;
  if ('equals' in c) return String(v ?? '') === c.equals;
  if ('notEquals' in c) {
    const s = String(v ?? '').trim();
    return s.length > 0 && s !== c.notEquals;
  }
  return c.in.includes(String(v ?? ''));
}

export interface ValidationResult {
  ok: boolean;
  /** Field key → message, for fields that failed. */
  errors: Record<string, string>;
  /** Visible, known fields only, normalised (trimmed text, numbers, booleans). */
  values: RequestValues;
}

/**
 * Checks a submission against the (tenant-effective) form. Unknown keys and
 * fields hidden by showIf are dropped; required visible fields must be filled.
 */
export function validateRequestValues(form: RequestFormDef, raw: unknown): ValidationResult {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};
  const values: RequestValues = {};
  const fields = allFields(form);

  // Toggles first, so showIf on a toggle sees the normalised value.
  const view: RequestValues = {};
  for (const f of fields) {
    const v = input[f.key];
    if (f.type === 'toggle') view[f.key] = v === true || v === 'true';
    else if (typeof v === 'string' || typeof v === 'number') view[f.key] = v;
  }

  for (const f of fields) {
    if (!isVisible(f, view)) continue;
    const v = input[f.key];
    if (f.type === 'toggle') {
      const checked = view[f.key] as boolean;
      if (f.required && !checked) {
        errors[f.key] = `${f.label} must be accepted`;
      } else {
        values[f.key] = checked;
      }
      continue;
    }
    const text = v === undefined || v === null ? '' : String(v).trim();
    if (!text) {
      if (f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    switch (f.type) {
      case 'number': {
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0) errors[f.key] = `${f.label} must be a number`;
        else values[f.key] = n;
        break;
      }
      case 'email':
        if (!EMAIL_RE.test(text) || text.length > 254) errors[f.key] = `${f.label} must be a valid email`;
        else values[f.key] = text.toLowerCase();
        break;
      case 'date':
        if (!DATE_RE.test(text) || Number.isNaN(Date.parse(text))) errors[f.key] = `${f.label} must be a date`;
        else values[f.key] = text;
        break;
      case 'time':
        if (!TIME_RE.test(text)) errors[f.key] = `${f.label} must be a time (HH:MM)`;
        else values[f.key] = text;
        break;
      case 'select':
        if (!f.options?.includes(text)) errors[f.key] = `Choose a valid ${f.label}`;
        else values[f.key] = text;
        break;
      case 'textarea':
        if (text.length > MAX_TEXTAREA) errors[f.key] = `${f.label} is too long`;
        else values[f.key] = text;
        break;
      default:
        if (text.length > MAX_TEXT) errors[f.key] = `${f.label} is too long`;
        else values[f.key] = text;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, values };
}

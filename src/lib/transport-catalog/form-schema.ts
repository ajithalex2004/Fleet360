/**
 * Transport request forms as data.
 *
 * Each Transport category (Rent-a-Car, Logistics, …) has a form made of
 * sections and fields. The default forms live in ./default-forms.ts; a tenant
 * can switch categories on and hide fields or change which are required
 * (tenant_transport_categories.field_overrides). The same definition drives
 * the screen (DynamicRequestForm) and the server-side check of a submission
 * (validateRequestValues), so a hidden or optional field is treated the same
 * in both places.
 *
 * Browser-safe: no Node imports.
 */

export type RequestFieldType =
  | 'text' | 'email' | 'tel' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'toggle';

/** Show the field only when another field has a value (data form of the old showIf functions). */
export type ShowIf =
  | { field: string; truthy: boolean }
  | { field: string; equals: string };

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
}

export interface RequestSectionDef {
  key: string;
  title: string;
  fields: RequestFieldDef[];
}

export interface RequestFormDef {
  sections: RequestSectionDef[];
}

/** A tenant's change to one field. */
export interface FieldOverride { hidden?: boolean; required?: boolean }
export type FieldOverrides = Record<string, FieldOverride>;

export type RequestValue = string | number | boolean;
export type RequestValues = Record<string, RequestValue>;

export function allFields(form: RequestFormDef): RequestFieldDef[] {
  return form.sections.flatMap((s) => s.fields);
}

/**
 * The form a tenant's customers see: hidden fields removed, required flags
 * changed. Core fields ignore overrides. Sections left empty are dropped.
 */
export function applyOverrides(form: RequestFormDef, overrides: FieldOverrides | null | undefined): RequestFormDef {
  const o = overrides ?? {};
  return {
    sections: form.sections
      .map((s) => ({
        ...s,
        fields: s.fields
          .filter((f) => f.core || !o[f.key]?.hidden)
          .map((f) => (f.core || o[f.key]?.required === undefined ? f : { ...f, required: o[f.key]!.required })),
      }))
      .filter((s) => s.fields.length > 0),
  };
}

/** Keeps only overrides for known, non-core fields, with boolean flags. */
export function cleanOverrides(form: RequestFormDef, raw: unknown): FieldOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const byKey = new Map(allFields(form).map((f) => [f.key, f]));
  const out: FieldOverrides = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    const f = byKey.get(key);
    if (!f || !v || typeof v !== 'object') return null;
    if (f.core) continue;
    const { hidden, required } = v as Record<string, unknown>;
    if ((hidden !== undefined && typeof hidden !== 'boolean') || (required !== undefined && typeof required !== 'boolean')) return null;
    const entry: FieldOverride = {};
    if (hidden === true) entry.hidden = true;
    if (typeof required === 'boolean' && required !== !!f.required) entry.required = required;
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

export function isVisible(field: RequestFieldDef, values: RequestValues): boolean {
  const c = field.showIf;
  if (!c) return true;
  const v = values[c.field];
  if ('truthy' in c) return !!v === c.truthy;
  return String(v ?? '') === c.equals;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TEXT = 200;
const MAX_TEXTAREA = 2000;

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
    if (f.type === 'toggle') { values[f.key] = view[f.key] as boolean; continue; }
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

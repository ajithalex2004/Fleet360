'use client';

/**
 * Renders a Transport request form from its definition
 * (src/lib/transport-catalog), in the shared form-kit style. Fields hidden by
 * showIf are not shown; server-side validation uses the same definition
 * (validateRequestValues), so pass its `errors` back in to show them.
 */

import {
  FormSection, FormField, TextInput, SelectInput, TextAreaInput, CheckboxField,
} from '@/components/ui/form-kit';
import {
  isVisible, type RequestFieldDef, type RequestFormDef, type RequestValues, type RequestValue,
} from '@/lib/transport-catalog/form-schema';

export function DynamicRequestForm({
  form, values, onChange, errors, disabled,
}: {
  form: RequestFormDef;
  values: RequestValues;
  onChange: (key: string, value: RequestValue) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {form.sections.map((s) => {
        const visible = s.fields.filter((f) => isVisible(f, values));
        if (!visible.length) return null;
        return (
          <FormSection key={s.key} title={s.title} columns={2}>
            {visible.map((f) => (
              <Field key={f.key} field={f} value={values[f.key]} onChange={onChange} error={errors?.[f.key]} disabled={disabled} />
            ))}
          </FormSection>
        );
      })}
    </div>
  );
}

function Field({ field: f, value, onChange, error, disabled }: {
  field: RequestFieldDef; value: RequestValue | undefined; onChange: (k: string, v: RequestValue) => void;
  error?: string; disabled?: boolean;
}) {
  const id = `rf-${f.key}`;
  const hint = error ? <span className="text-rose-500">{error}</span> : f.hint;
  if (f.type === 'toggle') {
    return (
      <div className="md:col-span-full">
        <CheckboxField label={f.label} hint={error ?? f.hint} checked={value === true} disabled={disabled} onChange={(v) => onChange(f.key, v)} />
      </div>
    );
  }
  const text = value === undefined || value === null ? '' : String(value);
  const common = {
    id, disabled, value: text, 'aria-invalid': error ? true : undefined,
    placeholder: f.placeholder,
  };
  let control: React.ReactNode;
  if (f.type === 'select') {
    control = (
      <SelectInput {...common} onChange={(e) => onChange(f.key, e.target.value)}>
        <option value="">— Select —</option>
        {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </SelectInput>
    );
  } else if (f.type === 'textarea') {
    control = <TextAreaInput {...common} maxLength={2000} onChange={(e) => onChange(f.key, e.target.value)} />;
  } else {
    const input = (
      <TextInput {...common} type={f.type} min={f.type === 'number' ? 0 : undefined} maxLength={f.type === 'number' ? undefined : 200}
        onChange={(e) => onChange(f.key, e.target.value)} />
    );
    control = f.unit ? (
      <div className="flex items-center gap-2">{input}<span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">{f.unit}</span></div>
    ) : input;
  }
  return (
    <FormField label={f.label} required={f.required} htmlFor={id} hint={hint} span={f.half ? undefined : 'full'}>
      {control}
    </FormField>
  );
}

/**
 * Transport request forms as data (src/lib/transport-catalog): tenant field
 * overrides, conditional fields and server-side validation of a submission.
 */
import { describe, it, expect } from 'vitest';
import {
  allFields, applyOverrides, cleanOverrides, isVisible, validateRequestValues,
} from '@/lib/transport-catalog/form-schema';
import { CATEGORY_DEFINITIONS } from '@/lib/transport-catalog/default-forms';
import { TRANSPORT_CATEGORIES } from '@/lib/customer-portal/catalog';

const RAC = CATEGORY_DEFINITIONS.RAC.form;
const LOGISTICS = CATEGORY_DEFINITIONS.LOGISTICS.form;
const LIMO = CATEGORY_DEFINITIONS.LIMOUSINE.form;

describe('default forms', () => {
  it('defines a form for every Transport category', () => {
    for (const c of TRANSPORT_CATEGORIES) {
      const def = CATEGORY_DEFINITIONS[c];
      expect(def.category).toBe(c);
      expect(def.form.sections.length).toBeGreaterThan(0);
    }
  });

  it('has unique field keys per form, options on every select, and showIf pointing at a real field', () => {
    for (const c of TRANSPORT_CATEGORIES) {
      const fields = allFields(CATEGORY_DEFINITIONS[c].form);
      const keys = fields.map((f) => f.key);
      expect(new Set(keys).size, c).toBe(keys.length);
      for (const f of fields) {
        if (f.type === 'select') expect(f.options?.length, `${c}.${f.key}`).toBeGreaterThan(0);
        if (f.showIf) expect(keys, `${c}.${f.key}`).toContain(f.showIf.field);
        if (f.core) expect(f.required, `${c}.${f.key} core must be required`).toBe(true);
      }
    }
  });
});

describe('overrides', () => {
  it('hides fields and changes required flags, but never touches core fields', () => {
    const form = applyOverrides(RAC, {
      emiratesId: { hidden: true }, phone: { required: true }, origin: { hidden: true }, vehicleCategory: { required: false },
    });
    const byKey = new Map(allFields(form).map((f) => [f.key, f]));
    expect(byKey.has('emiratesId')).toBe(false);
    expect(byKey.get('phone')?.required).toBe(true);
    expect(byKey.has('origin')).toBe(true);
    expect(byKey.get('vehicleCategory')?.required).toBe(true);
  });

  it('cleanOverrides drops core fields and no-op entries, rejects unknown keys and bad flags', () => {
    expect(cleanOverrides(RAC, { origin: { hidden: true }, phone: { required: false }, notes: { hidden: true } }))
      .toEqual({ notes: { hidden: true } });
    expect(cleanOverrides(RAC, { nope: { hidden: true } })).toBeNull();
    expect(cleanOverrides(RAC, { phone: { hidden: 'yes' } })).toBeNull();
    expect(cleanOverrides(RAC, [])).toBeNull();
  });
});

describe('conditional fields', () => {
  it('follows toggles and select values', () => {
    const tempRange = allFields(LOGISTICS).find((f) => f.key === 'tempRange')!;
    expect(isVisible(tempRange, {})).toBe(false);
    expect(isVisible(tempRange, { tempControlled: true })).toBe(true);
    const hours = allFields(LIMO).find((f) => f.key === 'hours')!;
    expect(isVisible(hours, { bookingType: 'Hourly' })).toBe(true);
    expect(isVisible(hours, { bookingType: 'Full Day' })).toBe(false);
    const returnLoc = allFields(RAC).find((f) => f.key === 'destination')!;
    expect(isVisible(returnLoc, {})).toBe(true);
    expect(isVisible(returnLoc, { sameReturnLoc: true })).toBe(false);
  });
});

describe('validateRequestValues', () => {
  const good = {
    requestorName: 'Sara', requestorEmail: 'Sara@Example.test', vehicleCategory: 'SUV',
    startDate: '2026-12-01', pickupTime: '09:30', origin: ' Dubai Mall ', additionalDriver: 'true', unknownKey: 'x',
  };

  it('accepts a valid request, normalises values and drops unknown keys', () => {
    const r = validateRequestValues(RAC, good);
    expect(r.ok).toBe(true);
    expect(r.values).toMatchObject({ requestorEmail: 'sara@example.test', origin: 'Dubai Mall', additionalDriver: true });
    expect(r.values).not.toHaveProperty('unknownKey');
  });

  it('reports missing required fields and bad values', () => {
    const r = validateRequestValues(RAC, { ...good, origin: '', vehicleCategory: 'Rocket', startDate: '01/12/2026', pickupTime: '25:00', requestorEmail: 'nope' });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['origin', 'pickupTime', 'requestorEmail', 'startDate', 'vehicleCategory']);
  });

  it('ignores fields hidden by showIf, even if sent', () => {
    const r = validateRequestValues(LOGISTICS, {
      companyName: 'Gulf', requestorName: 'A', requestorEmail: 'a@b.co', shipmentType: 'FTL – Full Truck Load',
      origin: 'A', destination: 'B', startDate: '2026-12-01', cargoType: 'General Goods', cargo: 'Boxes',
      tempRange: '2-8', isHazmat: false, unNumber: 'UN1950',
    });
    expect(r.ok).toBe(true);
    expect(r.values).not.toHaveProperty('tempRange');
    expect(r.values).not.toHaveProperty('unNumber');
  });

  it('enforces a tenant-required field and skips a tenant-hidden one', () => {
    const form = applyOverrides(RAC, { phone: { required: true }, emiratesId: { hidden: true } });
    const r = validateRequestValues(form, { ...good, emiratesId: '784' });
    expect(r.errors).toHaveProperty('phone');
    expect(r.values).not.toHaveProperty('emiratesId');
  });

  it('rejects negative or non-numeric numbers', () => {
    const lease = CATEGORY_DEFINITIONS.LEASING.form;
    expect(validateRequestValues(lease, { quantity: -2 }).errors).toHaveProperty('quantity');
    expect(validateRequestValues(lease, { quantity: 'many' }).errors).toHaveProperty('quantity');
  });
});

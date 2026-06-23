import { describe, expect, it } from 'vitest';
import {
  evaluateRule,
  conditionsHold,
  parseRule,
  applyAccessorialCatalog,
  type AccessorialContext,
  type AccessorialRule,
  type CatalogEntry,
} from '@/lib/logistics/accessorial-engine';

// ── parseRule — defensive against bad JSONB ────────────────────────────────

describe('parseRule', () => {
  it('returns null for non-objects and missing types', () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule(undefined)).toBeNull();
    expect(parseRule(42)).toBeNull();
    expect(parseRule({})).toBeNull();
    expect(parseRule({ type: 'unknown_kind' })).toBeNull();
  });

  it('rejects rules missing the required value field for their type', () => {
    expect(parseRule({ type: 'flat' })).toBeNull();              // no amount
    expect(parseRule({ type: 'flat', amount: 'ten' })).toBeNull(); // wrong type
    expect(parseRule({ type: 'percentage', percentage: 10 })).toBeNull(); // no basis
    expect(parseRule({ type: 'percentage', basis: 'bad', percentage: 10 })).toBeNull();
    expect(parseRule({ type: 'per_km' })).toBeNull();
  });

  it('accepts well-formed rules of every supported type', () => {
    expect(parseRule({ type: 'flat', amount: 50 })?.type).toBe('flat');
    expect(parseRule({ type: 'percentage', basis: 'base_rate', percentage: 10 })?.type).toBe('percentage');
    expect(parseRule({ type: 'per_km', rate: 2 })?.type).toBe('per_km');
    expect(parseRule({ type: 'per_kg', rate: 0.5 })?.type).toBe('per_kg');
    expect(parseRule({ type: 'per_stop', rate: 25 })?.type).toBe('per_stop');
  });
});

// ── conditionsHold ─────────────────────────────────────────────────────────

describe('conditionsHold', () => {
  const empty: AccessorialContext = {};

  it('returns ok when conditions is undefined', () => {
    expect(conditionsHold(undefined, empty).ok).toBe(true);
  });

  it('gates by minDistanceKm', () => {
    const c = { minDistanceKm: 100 };
    expect(conditionsHold(c, { distanceKm: 99 }).ok).toBe(false);
    expect(conditionsHold(c, { distanceKm: 100 }).ok).toBe(true);
    expect(conditionsHold(c, { distanceKm: null }).ok).toBe(false);
  });

  it('gates by maxDistanceKm', () => {
    expect(conditionsHold({ maxDistanceKm: 50 }, { distanceKm: 51 }).ok).toBe(false);
    expect(conditionsHold({ maxDistanceKm: 50 }, { distanceKm: 50 }).ok).toBe(true);
  });

  it('AND-s multiple conditions — all must hold', () => {
    const c = { minDistanceKm: 100, minWeightKg: 500 };
    expect(conditionsHold(c, { distanceKm: 200, weightKg: 400 }).ok).toBe(false);  // weight fails
    expect(conditionsHold(c, { distanceKm: 50,  weightKg: 600 }).ok).toBe(false);  // distance fails
    expect(conditionsHold(c, { distanceKm: 200, weightKg: 600 }).ok).toBe(true);   // both ok
  });

  it('vehicleTypes is case-insensitive', () => {
    expect(conditionsHold({ vehicleTypes: ['REEFER'] }, { vehicleType: 'reefer' }).ok).toBe(true);
    expect(conditionsHold({ vehicleTypes: ['REEFER'] }, { vehicleType: 'Flatbed' }).ok).toBe(false);
  });

  it('requiresHazmat only fires when set to true', () => {
    expect(conditionsHold({ requiresHazmat: true }, { isHazmat: false }).ok).toBe(false);
    expect(conditionsHold({ requiresHazmat: true }, { isHazmat: true }).ok).toBe(true);
  });

  it('requiresCrossBorder needs origin & destination countries to differ', () => {
    expect(conditionsHold({ requiresCrossBorder: true }, { originCountry: 'AE', destinationCountry: 'AE' }).ok).toBe(false);
    expect(conditionsHold({ requiresCrossBorder: true }, { originCountry: 'AE', destinationCountry: 'SA' }).ok).toBe(true);
    expect(conditionsHold({ requiresCrossBorder: true }, { originCountry: 'AE' }).ok).toBe(false);  // missing destination
  });
});

// ── evaluateRule — each rule type ──────────────────────────────────────────

describe('evaluateRule', () => {
  describe('flat', () => {
    it('returns the flat amount when conditions pass', () => {
      const v = evaluateRule({ type: 'flat', amount: 75, currency: 'AED' }, {});
      expect(v.applies).toBe(true);
      expect(v.amount).toBe(75);
      expect(v.currency).toBe('AED');
      expect(v.taxable).toBe(true);
    });

    it('returns non-applying when conditions fail', () => {
      const rule: AccessorialRule = { type: 'flat', amount: 50, conditions: { minDistanceKm: 100 } };
      const v = evaluateRule(rule, { distanceKm: 50 });
      expect(v.applies).toBe(false);
      expect(v.amount).toBe(0);
    });

    it('honours taxable=false', () => {
      const v = evaluateRule({ type: 'flat', amount: 30, taxable: false }, {});
      expect(v.taxable).toBe(false);
    });
  });

  describe('percentage', () => {
    it('applies % of base_rate', () => {
      const v = evaluateRule({ type: 'percentage', basis: 'base_rate', percentage: 10 }, { baseRate: 1000 });
      expect(v.applies).toBe(true);
      expect(v.amount).toBe(100);
      expect(v.reason).toContain('10% of base_rate=1000');
    });

    it('applies % of cargo_value for insurance-style rules', () => {
      const v = evaluateRule({ type: 'percentage', basis: 'cargo_value', percentage: 1.5 }, { cargoValue: 50_000 });
      expect(v.amount).toBe(750);
    });

    it('does not apply when the basis number is missing on the shipment', () => {
      const v = evaluateRule({ type: 'percentage', basis: 'cargo_value', percentage: 1 }, {});
      expect(v.applies).toBe(false);
      expect(v.reason).toContain('basis "cargo_value" not available');
    });
  });

  describe('per_km', () => {
    it('charges rate × distance', () => {
      const v = evaluateRule({ type: 'per_km', rate: 2 }, { distanceKm: 150 });
      expect(v.amount).toBe(300);
    });

    it('respects freeKm — first N km are free', () => {
      const v = evaluateRule({ type: 'per_km', rate: 2, freeKm: 50 }, { distanceKm: 150 });
      expect(v.amount).toBe(200);  // 100 chargeable km × 2
    });

    it('clamps to zero when distance is below freeKm', () => {
      const v = evaluateRule({ type: 'per_km', rate: 5, freeKm: 100 }, { distanceKm: 50 });
      expect(v.applies).toBe(false);  // amount=0 means non-applying
    });

    it('caps chargeable km at maxKm', () => {
      const v = evaluateRule({ type: 'per_km', rate: 1, freeKm: 0, maxKm: 100 }, { distanceKm: 500 });
      expect(v.amount).toBe(100);
    });
  });

  describe('per_kg', () => {
    it('charges rate × weight, with freeKg allowance', () => {
      const v = evaluateRule({ type: 'per_kg', rate: 0.5, freeKg: 1000 }, { weightKg: 3000 });
      expect(v.amount).toBe(1000);  // 2000 chargeable kg × 0.5
    });
  });

  describe('per_stop', () => {
    it('charges rate × stop count', () => {
      const v = evaluateRule({ type: 'per_stop', rate: 25 }, { stopsCount: 4 });
      expect(v.amount).toBe(100);
    });

    it('excludes the first stop when configured', () => {
      const v = evaluateRule({ type: 'per_stop', rate: 25, excludeFirst: true }, { stopsCount: 4 });
      expect(v.amount).toBe(75);  // 3 extra stops × 25
    });

    it('returns non-applying when excluding the first leaves zero', () => {
      const v = evaluateRule({ type: 'per_stop', rate: 25, excludeFirst: true }, { stopsCount: 1 });
      expect(v.applies).toBe(false);
    });
  });

  it('rounds amounts to 2 decimal places', () => {
    const v = evaluateRule({ type: 'percentage', basis: 'base_rate', percentage: 33.333 }, { baseRate: 100 });
    expect(v.amount).toBe(33.33);
  });

  it('clamps negative amounts to zero — a malformed rule never produces a refund', () => {
    const v = evaluateRule({ type: 'flat', amount: -50 }, {});
    expect(v.applies).toBe(false);
  });
});

// ── applyAccessorialCatalog — batch over the catalog ───────────────────────

describe('applyAccessorialCatalog', () => {
  const catalog: CatalogEntry[] = [
    {
      id: 'fuel-id', code: 'FUEL', name: 'Fuel surcharge',
      chargeType: 'FUEL', defaultAmount: 0, currency: 'AED', taxable: true,
      autoApplyRule: { type: 'percentage', basis: 'base_rate', percentage: 8 },
      status: 'ACTIVE',
    },
    {
      id: 'multi-drop-id', code: 'MULTI_DROP', name: 'Multi-drop fee',
      chargeType: 'STOP', defaultAmount: 0, currency: 'AED', taxable: true,
      autoApplyRule: { type: 'per_stop', rate: 30, excludeFirst: true, conditions: { minStops: 3 } },
      status: 'ACTIVE',
    },
    {
      id: 'cust-id', code: 'CUSTOMS', name: 'Customs clearance',
      chargeType: 'CUSTOMS', defaultAmount: 200, currency: 'AED', taxable: false,
      autoApplyRule: { type: 'flat', amount: 200, conditions: { requiresCrossBorder: true }, taxable: false },
      status: 'ACTIVE',
    },
    {
      id: 'inactive-id', code: 'WAITING', name: 'Waiting fee',
      chargeType: 'WAITING', defaultAmount: 50, currency: 'AED', taxable: true,
      autoApplyRule: { type: 'flat', amount: 50 },
      status: 'INACTIVE',  // ← should be skipped
    },
    {
      id: 'unparseable-id', code: 'BROKEN', name: 'Broken rule',
      chargeType: 'OTHER', defaultAmount: 10, currency: 'AED', taxable: true,
      autoApplyRule: { lol: 'this is not a rule' },  // ← should be skipped
      status: 'ACTIVE',
    },
  ];

  it('applies fuel + multi-drop for a typical multi-stop domestic shipment', () => {
    const applied = applyAccessorialCatalog(catalog, {
      baseRate: 1000,
      stopsCount: 4,
      originCountry: 'AE',
      destinationCountry: 'AE',
    });
    const codes = applied.map(a => a.code).sort();
    expect(codes).toEqual(['FUEL', 'MULTI_DROP']);

    const fuel = applied.find(a => a.code === 'FUEL')!;
    expect(fuel.amount).toBe(80);  // 8% of 1000
    expect(fuel.chargeType).toBe('FUEL');

    const multi = applied.find(a => a.code === 'MULTI_DROP')!;
    expect(multi.amount).toBe(90);  // 3 extra stops × 30
  });

  it('adds customs when crossing borders', () => {
    const applied = applyAccessorialCatalog(catalog, {
      baseRate: 1000,
      stopsCount: 1,
      originCountry: 'AE',
      destinationCountry: 'SA',
    });
    const codes = applied.map(a => a.code).sort();
    expect(codes).toEqual(['CUSTOMS', 'FUEL']);  // no multi-drop (only 1 stop)
    expect(applied.find(a => a.code === 'CUSTOMS')?.amount).toBe(200);
  });

  it('skips inactive and unparseable catalog entries', () => {
    const applied = applyAccessorialCatalog(catalog, {
      baseRate: 1000, stopsCount: 4,
      originCountry: 'AE', destinationCountry: 'AE',
    });
    expect(applied.find(a => a.code === 'WAITING')).toBeUndefined();
    expect(applied.find(a => a.code === 'BROKEN')).toBeUndefined();
  });

  it('returns empty list for a shipment that matches no rules', () => {
    const applied = applyAccessorialCatalog(catalog, {
      baseRate: 0,  // fuel becomes 0 → non-applying
      stopsCount: 1, // multi-drop minStops=3 fails
      originCountry: 'AE', destinationCountry: 'AE',  // customs requires cross-border
    });
    expect(applied).toEqual([]);
  });

  it('reason strings explain why each rule fired (for audit metadata)', () => {
    const applied = applyAccessorialCatalog(catalog, {
      baseRate: 500, stopsCount: 3,
      originCountry: 'AE', destinationCountry: 'AE',
    });
    expect(applied.find(a => a.code === 'FUEL')?.reason).toContain('8% of base_rate=500');
    expect(applied.find(a => a.code === 'MULTI_DROP')?.reason).toContain('30/stop × 2 stops');
  });

  it("uses the catalog row's taxable when the rule blob doesn't set it (no silent VAT)", () => {
    // The CUSTOMS entry has catalog taxable=false AND rule taxable=false,
    // so we make a tweaked catalog where the rule blob omits taxable.
    const tweaked: CatalogEntry[] = [{
      ...catalog.find(c => c.code === 'CUSTOMS')!,
      autoApplyRule: { type: 'flat', amount: 200, conditions: { requiresCrossBorder: true } },
      taxable: false,
    }];
    const applied = applyAccessorialCatalog(tweaked, {
      originCountry: 'AE', destinationCountry: 'SA',
    });
    expect(applied[0].taxable).toBe(false);
  });

  it("rule-level taxable=true beats catalog taxable=false (rule override wins)", () => {
    const tweaked: CatalogEntry[] = [{
      ...catalog.find(c => c.code === 'CUSTOMS')!,
      autoApplyRule: { type: 'flat', amount: 200, taxable: true, conditions: { requiresCrossBorder: true } },
      taxable: false,
    }];
    const applied = applyAccessorialCatalog(tweaked, {
      originCountry: 'AE', destinationCountry: 'SA',
    });
    expect(applied[0].taxable).toBe(true);
  });
});

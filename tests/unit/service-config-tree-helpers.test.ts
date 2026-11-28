import { describe, it, expect } from 'vitest';
import type { ServiceCategoryWithTypes, ServiceType } from '@/types/service-config';
import {
  canDeleteServiceCategory,
  canDeleteServiceType,
  pickNextSelectedTypeId,
  validateServiceConfigName,
} from '@/lib/service-config/tree-helpers';

function makeType(overrides: Partial<ServiceType> & { id: string; categoryId: string }): ServiceType {
  return {
    tenantId: 'tenant-1',
    key: overrides.id.toUpperCase(),
    name: overrides.id,
    description: null,
    icon: null,
    tone: 'violet',
    defaultPriority: 'Medium',
    sortOrder: 10,
    isSystem: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeCategory(
  overrides: Partial<ServiceCategoryWithTypes> & { id: string; types?: ServiceType[] },
): ServiceCategoryWithTypes {
  return {
    tenantId: 'tenant-1',
    key: overrides.id.toUpperCase(),
    name: overrides.id,
    description: null,
    icon: null,
    tone: 'emerald',
    sortOrder: 10,
    isSystem: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    types: [],
    ...overrides,
  };
}

describe('Service Configuration tree helpers', () => {
  it('allows deleting custom/FM service types and blocks system service types', () => {
    expect(canDeleteServiceType({ isSystem: false })).toEqual({ allowed: true });

    const sys = canDeleteServiceType({ isSystem: true });
    expect(sys.allowed).toBe(false);
    expect(sys.reason).toMatch(/Service Catalog/i);
  });

  it('enforces category deletion guards (system and non-empty)', () => {
    const emptyCustom = makeCategory({ id: 'cat-custom', isSystem: false, types: [] });
    expect(canDeleteServiceCategory(emptyCustom)).toEqual({ allowed: true });

    const nonEmptyCustom = makeCategory({
      id: 'cat-fm-soft',
      isSystem: false,
      types: [makeType({ id: 'fm-cleaning', categoryId: 'cat-fm-soft' })],
    });
    const nonEmptyCheck = canDeleteServiceCategory(nonEmptyCustom);
    expect(nonEmptyCheck.allowed).toBe(false);
    expect(nonEmptyCheck.reason).toMatch(/service types/i);

    const sysCat = makeCategory({ id: 'cat-sys', isSystem: true, types: [] });
    const sysCheck = canDeleteServiceCategory(sysCat);
    expect(sysCheck.allowed).toBe(false);
    expect(sysCheck.reason).toMatch(/System categories/i);
  });

  it('picks the best fallback service type after deletion', () => {
    const t1 = makeType({ id: 't1', categoryId: 'c1' });
    const t2 = makeType({ id: 't2', categoryId: 'c1' });
    const t3 = makeType({ id: 't3', categoryId: 'c1' });
    const t4 = makeType({ id: 't4', categoryId: 'c2' });
    const categories = [
      makeCategory({ id: 'c1', types: [t1, t2, t3] }),
      makeCategory({ id: 'c2', types: [t4] }),
    ];

    // Prefers next sibling in same category
    expect(pickNextSelectedTypeId(categories, 't1')).toBe('t2');
    expect(pickNextSelectedTypeId(categories, 't2')).toBe('t3');

    // Falls back to previous sibling when deleting last item in category
    expect(pickNextSelectedTypeId(categories, 't3')).toBe('t2');

    // Falls back to first type in another category when category becomes empty
    expect(pickNextSelectedTypeId(categories, 't4')).toBe('t1');

    // Returns null when the sole remaining type is deleted
    const single = [makeCategory({ id: 'c-only', types: [t4] })];
    expect(pickNextSelectedTypeId(single, 't4')).toBeNull();
  });

  it('validates and trims service config display names', () => {
    expect(validateServiceConfigName('  HVAC Maintenance  ')).toEqual({
      ok: true,
      value: 'HVAC Maintenance',
    });
    expect(validateServiceConfigName('')).toEqual({
      ok: false,
      error: 'Name is required.',
    });
    expect(validateServiceConfigName('   \t\n  ')).toEqual({
      ok: false,
      error: 'Name is required.',
    });
  });
});

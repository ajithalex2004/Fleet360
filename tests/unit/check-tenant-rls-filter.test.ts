import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hasTenantFilter } = require('../../scripts/check-tenant-rls.js') as {
  hasTenantFilter: (handlerBody: string) => boolean;
};

describe('check-tenant-rls --strict: explicit tenant filter detection', () => {
  it('recognises a tenant filter in a where clause', () => {
    expect(hasTenantFilter('tx.lease.findMany({ where: { tenantId, status } })')).toBe(true);
    expect(hasTenantFilter('tx.alert.findMany({ where: { contract: { id }, tenantId } })')).toBe(true);
    expect(hasTenantFilter('`SELECT * FROM t WHERE id = $1 AND tenant_id = $2`')).toBe(true);
  });

  it('recognises a write that stamps the row with the tenant', () => {
    expect(hasTenantFilter('tx.leaseBranch.create({ data: { ...body, tenantId } })')).toBe(true);
    expect(hasTenantFilter('`INSERT INTO finance_bank_accounts (tenant_id, bank_name) VALUES ($1,$2)`')).toBe(true);
  });

  it('does not accept a handler whose queries and writes never name the tenant', () => {
    expect(hasTenantFilter('tx.leaseBranch.create({ data: { ...body } })')).toBe(false);
    expect(hasTenantFilter('`INSERT INTO finance_bank_accounts (bank_name) VALUES ($1)`')).toBe(false);
    expect(hasTenantFilter('tx.vatReturn.findUnique({ where: { id: params.id } })')).toBe(false);
    expect(hasTenantFilter('`SELECT * FROM finance_expenses WHERE deleted_at IS NULL`')).toBe(false);
  });
});

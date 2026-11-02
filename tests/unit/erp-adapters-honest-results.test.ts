import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnterpriseConnectionConfig } from '@/lib/agents/types';

const erpFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/agents/enterprise-bridge/erp-fetch', () => ({ erpFetch }));

const { OdooJsonRpcAdapter } = await import('@/lib/agents/enterprise-bridge/adapters/odoo-adapter');
const { SapOdataAdapter } = await import('@/lib/agents/enterprise-bridge/adapters/sap-odata-adapter');

const conn = (systemType: EnterpriseConnectionConfig['systemType']): EnterpriseConnectionConfig => ({
  id: 'c1',
  tenantId: 't1',
  systemName: 'ERP',
  systemType,
  baseUrl: 'https://erp.example.com',
  authType: 'BASIC_AUTH',
  authCredentials: { username: 'u', password: 'p' },
  isActive: true,
  rateLimitPerMin: 60,
  healthStatus: 'UNTESTED',
});

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const invoice = { invoiceNumber: 'INV-1', totalAmountAed: 500 } as never;

describe('Odoo adapter reports what actually happened', () => {
  beforeEach(() => {
    erpFetch.mockReset();
  });

  it('an unreachable Odoo fails the connection test', async () => {
    erpFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await new OdooJsonRpcAdapter(conn('ODOO')).testConnection();
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/ECONNREFUSED/);
  });

  it('an HTTP error fails the connection test', async () => {
    erpFetch.mockResolvedValue(json(503, {}));
    expect((await new OdooJsonRpcAdapter(conn('ODOO')).testConnection()).success).toBe(false);
  });

  it('a failed create is a FAILED sync, never record #101', async () => {
    erpFetch.mockResolvedValue(json(200, { error: { message: 'Access Denied' } }));
    const res = await new OdooJsonRpcAdapter(conn('ODOO')).pushEntity('INVOICE', 'INV-1', invoice);
    expect(res.status).toBe('FAILED');
    expect(res.externalReferenceId).toBeUndefined();
    expect(res.message).toMatch(/Access Denied/);

    erpFetch.mockRejectedValue(new Error('timeout'));
    expect((await new OdooJsonRpcAdapter(conn('ODOO')).pushEntity('INVOICE', 'INV-1', invoice)).status).toBe('FAILED');
  });

  it('a real create reports the id Odoo returned', async () => {
    erpFetch.mockResolvedValue(json(200, { result: 4711 }));
    const res = await new OdooJsonRpcAdapter(conn('ODOO')).pushEntity('INVOICE', 'INV-1', invoice);
    expect(res.status).toBe('SUCCESS');
    expect(res.externalReferenceId).toBe('4711');
  });
});

describe('SAP adapter does not invent a CSRF token', () => {
  beforeEach(() => {
    erpFetch.mockReset();
  });

  it('a 401 without a token fails the connection test', async () => {
    erpFetch.mockResolvedValue(json(401, {}));
    expect((await new SapOdataAdapter(conn('SAP_S4HANA')).testConnection()).success).toBe(false);
  });

  it('a 200 without a token fails too', async () => {
    erpFetch.mockResolvedValue(json(200, {}));
    expect((await new SapOdataAdapter(conn('SAP_S4HANA')).testConnection()).success).toBe(false);
  });

  it('a real token passes', async () => {
    erpFetch.mockResolvedValue(json(200, {}, { 'x-csrf-token': 'abc123' }));
    expect((await new SapOdataAdapter(conn('SAP_S4HANA')).testConnection()).success).toBe(true);
  });
});

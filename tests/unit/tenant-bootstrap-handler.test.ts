import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  tenantBootstrapHandler,
  createRestrictedBootstrapClient,
  BootstrapAccessDeniedError,
  BOOTSTRAP_ALLOWED_OPERATIONS,
} from '@/lib/handlers/tenant-bootstrap-handler';

describe('tenantBootstrapHandler & Delegate Sandbox', () => {
  it('allows permitted bootstrap delegates on the restricted client', () => {
    const mockTx = {
      tenant: { findMany: vi.fn() },
      user: { create: vi.fn() },
      userTenant: { create: vi.fn() },
      tenantModule: { createMany: vi.fn() },
      role: { findFirst: vi.fn() },
      $queryRawUnsafe: vi.fn(),
      vehicle: { findMany: vi.fn() },
      leaseInvoice: { findMany: vi.fn() },
    } as any;

    const restricted = createRestrictedBootstrapClient(mockTx);

    expect(restricted.tenant).toBeDefined();
    expect(restricted.user).toBeDefined();
    expect(restricted.userTenant).toBeDefined();
    expect(restricted.tenantModule).toBeDefined();
    expect(restricted.role).toBeDefined();
    expect(restricted.$queryRawUnsafe).toBeDefined();
  });

  it('throws BootstrapAccessDeniedError when attempting to access tenant business models', () => {
    const mockTx = {
      tenant: { findMany: vi.fn() },
      vehicle: { findMany: vi.fn() },
      leaseInvoice: { findMany: vi.fn() },
      tripSchedule: { findMany: vi.fn() },
    } as any;

    const restricted = createRestrictedBootstrapClient(mockTx);

    expect(() => restricted.vehicle).toThrow(BootstrapAccessDeniedError);
    expect(() => restricted.leaseInvoice).toThrow(BootstrapAccessDeniedError);
    expect(() => restricted.tripSchedule).toThrow(BootstrapAccessDeniedError);
  });

  it('rejects unallowed bootstrap capability with 403', async () => {
    const req = new NextRequest('http://localhost:3000/api/tenants/provision', { method: 'POST' });
    const res = await tenantBootstrapHandler(req, 'unauthorized_op' as any, async () => {
      return NextResponse.json({ ok: true });
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies before importing the route
vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      $transaction: vi.fn(async (cb) => {
        const mockTx = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          $queryRawUnsafe: vi.fn().mockImplementation(async (query: string) => {
            const match = query.match(/set_config\('app\.tenant_id',\s*'([^']+)'/);
            if (match) {
              return [{ v: match[1] }];
            }
            return [{ v: 'mock' }];
          }),
          leaseQuotation: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'quo-1',
                tenantId: 'tenant-alpha',
                quotationNumber: 'QUO-0001',
                status: 'NEW',
                vehicles: [],
                lineItems: [],
                lessee: { name: 'Acme Corp' },
                deletedAt: null,
              },
            ]),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockImplementation(async ({ data }) => ({
              id: 'quo-created-1',
              ...data,
              vehicles: data.vehicles?.create || [],
              lineItems: data.lineItems?.create || [],
              lessee: { name: 'Test Lessee' },
            })),
          },
        };
        return cb(mockTx);
      }),
    },
  };
});

vi.mock('@/lib/leasing/serial-lock', () => ({
  lockSerialSeries: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from '@/app/api/leasing/quotations/route';

describe('Leasing Quotations API (/api/leasing/quotations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/leasing/quotations', () => {
    it('rejects unauthenticated requests missing x-tenant-id with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'GET',
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Authentication required');
    });

    it('returns quotation list for authorized tenant context', async () => {
      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'GET',
        headers: {
          'x-tenant-id': 'tenant-alpha',
          'x-user-id': 'user-123',
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json)).toBe(true);
      expect(json).toHaveLength(1);
      expect(json[0].quotationNumber).toBe('QUO-0001');
    });
  });

  describe('POST /api/leasing/quotations', () => {
    it('rejects unauthenticated creation requests with 401', async () => {
      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          monthlyRent: 2500,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Authentication required');
    });

    it('creates a quotation with auto-generated quotationNumber and auto-derived line items', async () => {
      const payload = {
        monthlyRent: 3500,
        accessoriesCost: 200,
        servicesCost: 150,
        insuranceIncluded: true,
        insuranceCost: 500,
        durationMonths: 12,
        vehicles: [
          {
            vehicleType: 'SUV',
            make: 'Toyota',
            model: 'Prado',
            year: 2026,
            quantity: 1,
            monthlyRate: 3500,
          },
        ],
      };

      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-alpha',
          'x-user-id': 'user-alpha-sales',
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();

      expect(json.tenantId).toBe('tenant-alpha');
      expect(json.quotationNumber).toBe('QUO-0001');
      expect(json.status).toBe('NEW');
      expect(json.vehicles).toHaveLength(1);
      expect(json.vehicles[0].make).toBe('Toyota');
      expect(json.vehicles[0].model).toBe('Prado');

      // Auto-derived line items: ACCESSORY (200), SERVICE (150), INSURANCE (500)
      expect(json.lineItems).toHaveLength(3);
      const types = json.lineItems.map((li: any) => li.itemType);
      expect(types).toContain('ACCESSORY');
      expect(types).toContain('SERVICE');
      expect(types).toContain('INSURANCE');
    });

    it('uses explicit lineItems when provided by caller', async () => {
      const payload = {
        monthlyRent: 5000,
        lineItems: [
          {
            itemType: 'CUSTOM_UPFIT',
            description: 'Heavy duty tow bar',
            quantity: 1,
            unitRate: 1200,
            monthlyAmount: 100,
            totalAmount: 1200,
            currency: 'AED',
          },
        ],
      };

      const req = new NextRequest('http://localhost:3000/api/leasing/quotations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tenant-id': 'tenant-beta',
          'x-user-id': 'user-beta-sales',
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();

      expect(json.tenantId).toBe('tenant-beta');
      expect(json.lineItems).toHaveLength(1);
      expect(json.lineItems[0].itemType).toBe('CUSTOM_UPFIT');
      expect(json.lineItems[0].totalAmount).toBe(1200);
    });
  });
});

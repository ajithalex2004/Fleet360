import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  RENTAL_CUSTOMER_TYPES,
  RENTAL_VEHICLE_CATEGORIES,
  categoriesMatch,
  formatRentalCategoryLabel,
  normalizeRentalCategory,
} from '@/lib/rental/categories';
import { canBookRacPortal, canFinanceRacPortal } from '@/app/rac-portal/rac-portal-shell';
import { slugifyTenant } from '@/app/portal/[tenantSlug]/rac/_use-verified-portal-tenant';

const {
  mockWithTenantRls,
  mockWithPlatformAdmin,
  mockStorageUpload,
} = vi.hoisted(() => ({
  mockWithTenantRls: vi.fn(),
  mockWithPlatformAdmin: vi.fn(),
  mockStorageUpload: vi.fn(),
}));

vi.mock('@/lib/rls', () => ({
  withTenantRls: mockWithTenantRls,
  withPlatformAdmin: mockWithPlatformAdmin,
}));

vi.mock('@/lib/storage', () => ({
  getStorage: () => ({
    upload: mockStorageUpload,
    delete: vi.fn(),
  }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

describe('Section 5.1 — Unified RAC Vehicle Categories & Customer Segments', () => {
  it('normalizes all legacy UI category variants into the 14 canonical tariff codes', () => {
    const canonicalSet = new Set(RENTAL_VEHICLE_CATEGORIES.map((c) => c.value));
    expect(canonicalSet.size).toBe(14);

    expect(normalizeRentalCategory('Economy')).toBe('ECONOMY');
    expect(normalizeRentalCategory('MID_SIZE_SEDAN')).toBe('MID_SIZE');
    expect(normalizeRentalCategory('FULL_SIZE_SEDAN')).toBe('FULL_SIZE');
    expect(normalizeRentalCategory('STANDARD_SUV')).toBe('MID_SIZE_SUV');
    expect(normalizeRentalCategory('LUXURY_SUV')).toBe('LUXURY');
    expect(normalizeRentalCategory('EXECUTIVE')).toBe('LUXURY');
    expect(normalizeRentalCategory('MINI_BUS')).toBe('BUS');
    expect(normalizeRentalCategory('Minibus')).toBe('BUS');
    expect(normalizeRentalCategory('Truck')).toBe('PICKUP');

    for (const alias of [
      'Economy',
      'FULL_SIZE_SEDAN',
      'LUXURY_SUV',
      'MINI_BUS',
      'Minibus',
      'STANDARD_SUV',
    ]) {
      expect(canonicalSet.has(normalizeRentalCategory(alias))).toBe(true);
    }

    expect(categoriesMatch('FULL_SIZE_SEDAN', 'FULL_SIZE')).toBe(true);
    expect(categoriesMatch('MINI_BUS', 'Minibus')).toBe(true);
    expect(formatRentalCategoryLabel('MID_SIZE_SEDAN', { short: true })).toBe('Mid-Size Sedan');
  });

  it('includes all 6 RAC customer segments across admin and pricing forms', () => {
    expect(RENTAL_CUSTOMER_TYPES.map((t) => t.value)).toEqual([
      'INDIVIDUAL',
      'CORPORATE',
      'AIRLINE',
      'INSURANCE',
      'FREQUENT_FLYER',
      'GOVERNMENT',
    ]);
  });
});

describe('Section 5.2 — Portal Role Gating & Tenant Slug Verification', () => {
  it('separates booking/extension permissions from finance e-sign/payment permissions to prevent orphaned card holds', () => {
    expect(canBookRacPortal('RAC_B2B_BOOKER')).toBe(true);
    expect(canBookRacPortal('RAC_B2B_USER')).toBe(true);
    expect(canBookRacPortal('RAC_B2B_ADMIN')).toBe(true);
    expect(canBookRacPortal('RAC_B2B_FINANCE')).toBe(false);
    expect(canBookRacPortal('RAC_B2B_VIEWER')).toBe(false);

    expect(canFinanceRacPortal('RAC_B2B_FINANCE')).toBe(true);
    expect(canFinanceRacPortal('RAC_B2B_ADMIN')).toBe(true);
    expect(canFinanceRacPortal('RAC_B2B_BOOKER')).toBe(false);
    expect(canFinanceRacPortal('RAC_B2B_USER')).toBe(false);
    expect(canFinanceRacPortal('RAC_B2B_VIEWER')).toBe(false);
  });

  it('slugifies tenant codes and legal names deterministically for /portal/[tenantSlug]/rac', () => {
    expect(slugifyTenant('GULF-RAC')).toBe('gulf-rac');
    expect(slugifyTenant('Gulf Rent A Car LLC')).toBe('gulf-rent-a-car-llc');
    expect(slugifyTenant('  ')).toBeNull();
  });
});

describe('Section 5.1 — Native RAC Document & Walkaround Upload Endpoint (/api/rental/documents/upload)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks VIEWER with 403 while allowing RAC_OPERATOR to upload verified PNG walkaround photos under rental/bookings/*', async () => {
    const { POST } = await import('@/app/api/rental/documents/upload/route');

    // Valid 1x1 PNG magic bytes
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex',
    );

    const buildUploadReq = (role: string) => {
      const fd = new FormData();
      fd.set('file', new File([pngBytes], 'walkaround.png', { type: 'image/png' }));
      fd.set('entityType', 'BOOKING');
      fd.set('entityId', '22222222-2222-4222-8222-222222222222');
      fd.set('docType', 'VEHICLE_PHOTO');
      return new NextRequest('http://localhost/api/rental/documents/upload', {
        method: 'POST',
        headers: {
          'x-tenant-id': '11111111-1111-4111-8111-111111111111',
          'x-user-role': role,
        },
        body: fd,
      });
    };

    // 1. VIEWER lacks rental:create:counter -> 403 without touching DB or storage
    const deniedRes = await POST(buildUploadReq('VIEWER'));
    expect(deniedRes.status).toBe(403);
    expect(mockStorageUpload).not.toHaveBeenCalled();

    // 2. Cross-tenant / missing bookingId -> 404 BEFORE persisting bytes to storage
    mockWithTenantRls.mockImplementationOnce(async (_prisma: unknown, _tid: string, fn: (tx: unknown) => unknown) =>
      fn({
        rentalBooking: { findFirst: vi.fn().mockResolvedValue(null) },
        rentalAgreement: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    const notFoundRes = await POST(buildUploadReq('RAC_OPERATOR'));
    expect(notFoundRes.status).toBe(404);
    expect(mockStorageUpload).not.toHaveBeenCalled();

    // 3. RAC_OPERATOR on valid tenant booking -> 201 stored under rental/bookings/<bookingId>
    mockWithTenantRls.mockImplementationOnce(async (_prisma: unknown, _tid: string, fn: (tx: unknown) => unknown) =>
      fn({
        rentalBooking: {
          findFirst: vi.fn().mockResolvedValue({ id: '22222222-2222-4222-8222-222222222222' }),
        },
        rentalAgreement: { findFirst: vi.fn() },
      }),
    );
    mockStorageUpload.mockResolvedValueOnce({
      key: 'rental/bookings/22222222-2222-4222-8222-222222222222/abc.png',
      url: '/api/files/rental/bookings/22222222-2222-4222-8222-222222222222/abc.png',
      size: pngBytes.byteLength,
      mimeType: 'image/png',
      originalName: 'walkaround.png',
    });

    const okRes = await POST(buildUploadReq('RAC_OPERATOR'));
    expect(okRes.status).toBe(201);
    const json = await okRes.json();
    expect(json.url).toBe(
      '/api/files/rental/bookings/22222222-2222-4222-8222-222222222222/abc.png',
    );
    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: 'rental/bookings/22222222-2222-4222-8222-222222222222',
      }),
    );
  });
});

describe('Section 5.2 — Public OTP E-Sign Tenant Isolation (/api/esign/verify)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to sign an esign_request row whose tenant_id is missing instead of mutating under platform-admin', async () => {
    const { POST } = await import('@/app/api/esign/verify/route');

    // Token lookup uses read-only platform lookup to discover tenant_id; simulate corrupted row with null tenant_id
    mockWithPlatformAdmin.mockImplementation(async (_prisma: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        $executeRawUnsafe: vi.fn().mockResolvedValue(1),
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          {
            id: 'esign-1',
            tenant_id: null,
            contract_id: 'agr-1',
            contract_type: 'RENTAL_AGREEMENT',
            contract_ref: 'RA-000001',
            document_title: 'Rental Agreement RA-000001',
            signer_name: 'Test Customer',
            signer_phone: '+971501234567',
            signer_email: 'customer@example.com',
            sent_via: 'EMAIL',
            otp_code: '123456',
            otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            status: 'PENDING',
            failed_attempts: 0,
          },
        ]),
      }),
    );

    const req = new NextRequest('http://localhost/api/esign/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({
        signingToken: 'tok_missing_tenant_12345',
        otpCode: '123456',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    // Must NEVER execute any tenant mutation when tenant_id is missing
    expect(mockWithTenantRls).not.toHaveBeenCalled();
  });
});

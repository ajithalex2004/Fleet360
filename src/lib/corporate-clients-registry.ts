export interface CorporateClientRecord {
  id: string;
  clientName: string;
  emailDomain: string; // e.g. "ein360.ae"
  tenantId: string;
  tenantName: string;
  costCenterCode: string;
  discountPercent: number;
  billingMethod: string;
  creditLimitAed: number;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

// Master in-memory registry for corporate client domain mappings
export const CORPORATE_CLIENTS_REGISTRY: CorporateClientRecord[] = [
  {
    id: 'cli-ein360-001',
    clientName: 'EIN360',
    emailDomain: 'ein360.ae',
    tenantId: 'tnt-exl-solutions',
    tenantName: 'EXL Solutions',
    costCenterCode: 'CC-EIN360-LOGISTICS',
    discountPercent: 15,
    billingMethod: 'CORPORATE_ACCOUNT',
    creditLimitAed: 50000,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cli-emaar-002',
    clientName: 'Emaar Properties',
    emailDomain: 'emaar.ae',
    tenantId: 'tnt-exl-solutions',
    tenantName: 'EXL Solutions',
    costCenterCode: 'CC-EMAAR-EXP2026',
    discountPercent: 12,
    billingMethod: 'CORPORATE_ACCOUNT',
    creditLimitAed: 100000,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'cli-chalhoub-003',
    clientName: 'Chalhoub Group',
    emailDomain: 'chalhoub.com',
    tenantId: 'tnt-exl-solutions',
    tenantName: 'EXL Solutions',
    costCenterCode: 'CC-CHALHOUB-RETAIL',
    discountPercent: 10,
    billingMethod: 'CORPORATE_ACCOUNT',
    creditLimitAed: 75000,
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

export interface AuthorizedClientUser {
  id: string;
  name: string;
  mobileNumber: string; // e.g. "+971 50 887 6543"
  email: string; // e.g. "fatima@ein360.ae"
  role: 'LOGISTICS_LEAD' | 'DISPATCHER' | 'PROCUREMENT_MANAGER' | 'REQUESTER';
  costCenter: string;
  maxSpendingLimitAed?: number;
  status: 'ACTIVE' | 'SUSPENDED';
  lastLoginAt?: string;
  createdAt: string;
}

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
  userRoster: AuthorizedClientUser[];
}

export interface TenantAuthSettings {
  tenantId: string;
  enableSmsAuth: boolean; // Optional SMS authentication toggle
  enableWhatsAppAuth: boolean;
  enableEmailAuth: boolean;
  otpExpirySeconds: number;
}

export const TENANT_AUTH_SETTINGS: Record<string, TenantAuthSettings> = {
  'tnt-exl-solutions': {
    tenantId: 'tnt-exl-solutions',
    enableSmsAuth: true, // Configurable in Tenant Settings
    enableWhatsAppAuth: true,
    enableEmailAuth: true,
    otpExpirySeconds: 300, // 5 minutes
  },
};

// Master in-memory registry for corporate client domain mappings and rosters
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
    userRoster: [
      {
        id: 'usr-ein-001',
        name: 'Fatima Al-Nuaimi',
        mobileNumber: '+971 50 887 6543',
        email: 'fatima@ein360.ae',
        role: 'LOGISTICS_LEAD',
        costCenter: 'CC-EIN360-LOGISTICS',
        maxSpendingLimitAed: 15000,
        status: 'ACTIVE',
        lastLoginAt: '2026-09-03T11:45:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'usr-ein-002',
        name: 'Rashid Al-Mansoori',
        mobileNumber: '+971 50 112 3344',
        email: 'rashid@ein360.ae',
        role: 'DISPATCHER',
        costCenter: 'CC-EIN360-LOGISTICS',
        maxSpendingLimitAed: 5000,
        status: 'ACTIVE',
        lastLoginAt: '2026-09-02T16:20:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        id: 'usr-ein-003',
        name: 'Procurement Operations Desk',
        mobileNumber: '+971 4 800 3463',
        email: 'procurement@ein360.ae',
        role: 'PROCUREMENT_MANAGER',
        costCenter: 'CC-EIN360-LOGISTICS',
        maxSpendingLimitAed: 50000,
        status: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
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
    userRoster: [
      {
        id: 'usr-emaar-001',
        name: 'Zaid Al-Hashimi',
        mobileNumber: '+971 50 554 9988',
        email: 'zaid@emaar.ae',
        role: 'LOGISTICS_LEAD',
        costCenter: 'CC-EMAAR-EXP2026',
        maxSpendingLimitAed: 25000,
        status: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
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
    userRoster: [
      {
        id: 'usr-chalhoub-001',
        name: 'Nadine Kassam',
        mobileNumber: '+971 50 776 1122',
        email: 'nadine@chalhoub.com',
        role: 'REQUESTER',
        costCenter: 'CC-CHALHOUB-RETAIL',
        maxSpendingLimitAed: 8000,
        status: 'ACTIVE',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  },
];

export function cleanPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

export function lookupUserInCorporateRoster(query: string): {
  client: CorporateClientRecord;
  user: AuthorizedClientUser;
} | null {
  const clean = query.trim().toLowerCase();
  const numericOnly = cleanPhone(query);

  for (const client of CORPORATE_CLIENTS_REGISTRY) {
    for (const user of client.userRoster) {
      if (user.status !== 'ACTIVE') continue;

      // Match by exact email
      if (user.email.toLowerCase() === clean) {
        return { client, user };
      }

      // Match by phone number
      const userPhoneClean = cleanPhone(user.mobileNumber);
      if (
        numericOnly.length >= 7 &&
        (userPhoneClean.includes(numericOnly) || numericOnly.includes(userPhoneClean))
      ) {
        return { client, user };
      }
    }
  }

  return null;
}

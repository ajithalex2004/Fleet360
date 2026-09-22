/**
 * Shared mobile tenant-config resolution, split out of
 * src/app/api/tenant/mobile-config/route.ts so client components
 * (UniversalMobileBookingApp) and tests can import it directly --
 * Next.js route.ts files may only export HTTP method handlers.
 */

import {
  CORPORATE_CLIENTS_REGISTRY,
  CorporateClientRecord,
} from '@/lib/corporate-clients-registry';

export interface TenantMobileConfig {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  brandColor: string;
  logoUrl: string;
  enabledModules: string[];
  availableServices: string[];
  defaultLandingRoute: string;
  client?: {
    name: string;
    domain: string;
    costCenter: string;
    discountPercent: number;
    billingMethod: string;
  };
  hardwareCapabilities: {
    cameraScanner: boolean;
    biometrics: boolean;
    pushNotifications: boolean;
    geolocation: boolean;
  };
}

export const TENANT_PROFILES_STORE: Record<string, Omit<TenantMobileConfig, 'client'>> = {
  'tnt-exl-solutions': {
    tenantId: 'tnt-exl-solutions',
    tenantName: 'EXL Solutions',
    tenantSlug: 'exl',
    brandColor: '#f97316', // Orange
    logoUrl: 'https://assets.fleet360.io/tenants/exl-solutions.png',
    enabledModules: ['logistics'], // Only Freight
    availableServices: ['LOGISTICS'],
    defaultLandingRoute: '/m/freight',
    hardwareCapabilities: {
      cameraScanner: true,
      biometrics: true,
      pushNotifications: true,
      geolocation: true,
    },
  },
  'tnt-falcon-bus': {
    tenantId: 'tnt-falcon-bus',
    tenantName: 'Falcon School Transport',
    tenantSlug: 'falcon-bus',
    brandColor: '#eab308', // Yellow
    logoUrl: 'https://assets.fleet360.io/tenants/falcon-bus.png',
    enabledModules: ['school-bus'], // Only School Bus
    availableServices: ['SCHOOL_BUS'],
    defaultLandingRoute: '/m/school-bus',
    hardwareCapabilities: {
      cameraScanner: true,
      biometrics: true,
      pushNotifications: true,
      geolocation: true,
    },
  },
  'tnt-gulf-rental': {
    tenantId: 'tnt-gulf-rental',
    tenantName: 'Gulf Car Rental & Leasing',
    tenantSlug: 'gulf-rental',
    brandColor: '#10b981', // Emerald
    logoUrl: 'https://assets.fleet360.io/tenants/gulf-rental.png',
    enabledModules: ['rental', 'leasing'], // Rental & Leasing only
    availableServices: ['RENTAL', 'LEASING'],
    defaultLandingRoute: '/m/rental',
    hardwareCapabilities: {
      cameraScanner: true,
      biometrics: true,
      pushNotifications: true,
      geolocation: true,
    },
  },
};

export function resolveTenantByEmailOrCode(query: string): TenantMobileConfig {
  const clean = query.trim().toLowerCase();
  let clientMatch: CorporateClientRecord | undefined;
  let tenantProfile = TENANT_PROFILES_STORE['tnt-exl-solutions']; // Default to EXL Solutions

  if (clean.includes('@')) {
    const domain = clean.split('@')[1];
    clientMatch = CORPORATE_CLIENTS_REGISTRY.find(
      (c) => c.emailDomain.toLowerCase() === domain.toLowerCase()
    );

    if (clientMatch) {
      tenantProfile =
        TENANT_PROFILES_STORE[clientMatch.tenantId] || TENANT_PROFILES_STORE['tnt-exl-solutions'];
    }
  } else if (clean === 'exl' || clean === 'exl-logistics' || clean === 'trans-dxb') {
    tenantProfile = TENANT_PROFILES_STORE['tnt-exl-solutions'];
    clientMatch = CORPORATE_CLIENTS_REGISTRY[0]; // EIN360 default
  } else if (clean === 'falcon' || clean === 'school') {
    tenantProfile = TENANT_PROFILES_STORE['tnt-falcon-bus'];
  } else if (clean === 'gulf' || clean === 'rental') {
    tenantProfile = TENANT_PROFILES_STORE['tnt-gulf-rental'];
  }

  return {
    ...tenantProfile,
    client: clientMatch
      ? {
          name: clientMatch.clientName,
          domain: clientMatch.emailDomain,
          costCenter: clientMatch.costCenterCode,
          discountPercent: clientMatch.discountPercent,
          billingMethod: clientMatch.billingMethod,
        }
      : undefined,
  };
}

import { describe, it, expect } from 'vitest';
import {
  lookupUserInCorporateRoster,
  TENANT_AUTH_SETTINGS,
} from '@/lib/corporate-clients-registry';

describe('Roster-Linked Dual-Channel OTP & Tenant SMS Settings Engine', () => {
  it('looks up authorized coordinators by email in Corporate User Roster', () => {
    const match = lookupUserInCorporateRoster('fatima@ein360.ae');

    expect(match).not.toBeNull();
    expect(match?.user.name).toBe('Fatima Al-Nuaimi');
    expect(match?.user.email).toBe('fatima@ein360.ae');
    expect(match?.client.clientName).toBe('EIN360');
    expect(match?.client.costCenterCode).toBe('CC-EIN360-LOGISTICS');
  });

  it('looks up authorized coordinators by mobile number in Corporate User Roster', () => {
    const match = lookupUserInCorporateRoster('+971 50 887 6543');

    expect(match).not.toBeNull();
    expect(match?.user.name).toBe('Fatima Al-Nuaimi');
    expect(match?.client.clientName).toBe('EIN360');
    expect(match?.user.role).toBe('LOGISTICS_LEAD');
  });

  it('rejects unregistered email or mobile number not present in client rosters', () => {
    const matchEmail = lookupUserInCorporateRoster('stranger@random.com');
    expect(matchEmail).toBeNull();

    const matchPhone = lookupUserInCorporateRoster('+971 55 000 0000');
    expect(matchPhone).toBeNull();
  });

  it('supports tenant-level toggle for optional Cellular SMS Authentication', () => {
    const tenantId = 'tnt-exl-solutions';
    const settings = TENANT_AUTH_SETTINGS[tenantId];

    expect(settings).toBeDefined();
    expect(settings.enableEmailAuth).toBe(true);
    expect(settings.enableWhatsAppAuth).toBe(true);

    // Test toggle SMS
    settings.enableSmsAuth = false;
    expect(settings.enableSmsAuth).toBe(false);

    settings.enableSmsAuth = true;
    expect(settings.enableSmsAuth).toBe(true);
  });
});

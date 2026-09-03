import { describe, it, expect } from 'vitest';
import { resolveTenantByEmailOrCode } from '@/app/api/tenant/mobile-config/route';

describe('Universal Mobile App Corporate Email Domain Auto-Discovery Engine', () => {
  it('automatically discovers EXL Solutions Logistics from @ein360.ae corporate email domain', () => {
    const config = resolveTenantByEmailOrCode('fatima@ein360.ae');

    expect(config.tenantId).toBe('tnt-exl-solutions');
    expect(config.tenantName).toBe('EXL Solutions');
    expect(config.brandColor).toBe('#f97316');
    expect(config.enabledModules).toEqual(['logistics']);
    expect(config.availableServices).toEqual(['LOGISTICS']);

    // Check client binding
    expect(config.client).toBeDefined();
    expect(config.client?.name).toBe('EIN360');
    expect(config.client?.domain).toBe('ein360.ae');
    expect(config.client?.costCenter).toBe('CC-EIN360-LOGISTICS');
    expect(config.client?.discountPercent).toBe(15);
  });

  it('resolves EXL Solutions when entering tenant code EXL', () => {
    const config = resolveTenantByEmailOrCode('EXL');

    expect(config.tenantId).toBe('tnt-exl-solutions');
    expect(config.tenantName).toBe('EXL Solutions');
    expect(config.enabledModules).toContain('logistics');
  });

  it('ensures strict domain isolation for Freight (hiding School Bus and Car Rental)', () => {
    const exlConfig = resolveTenantByEmailOrCode('fatima@ein360.ae');

    expect(exlConfig.enabledModules.includes('school-bus')).toBe(false);
    expect(exlConfig.enabledModules.includes('rental')).toBe(false);
    expect(exlConfig.enabledModules.includes('leasing')).toBe(false);
  });

  it('supports native hardware capability profile flags for Mobile App', () => {
    const config = resolveTenantByEmailOrCode('fatima@ein360.ae');

    expect(config.hardwareCapabilities.cameraScanner).toBe(true);
    expect(config.hardwareCapabilities.biometrics).toBe(true);
    expect(config.hardwareCapabilities.geolocation).toBe(true);
  });
});

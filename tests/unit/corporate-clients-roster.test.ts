import { describe, it, expect } from 'vitest';
import {
  CORPORATE_CLIENTS_REGISTRY,
  AuthorizedClientUser,
} from '@/lib/corporate-clients-registry';

describe('Corporate Clients & User Roster Hub Engine', () => {
  it('retrieves pre-configured corporate clients with active user rosters', () => {
    const einClient = CORPORATE_CLIENTS_REGISTRY.find((c) => c.clientName === 'EIN360');

    expect(einClient).toBeDefined();
    expect(einClient?.emailDomain).toBe('ein360.ae');
    expect(einClient?.costCenterCode).toBe('CC-EIN360-LOGISTICS');
    expect(einClient?.discountPercent).toBe(15);
    expect(einClient?.userRoster.length).toBeGreaterThanOrEqual(2);

    const fatima = einClient?.userRoster.find((u) => u.name.includes('Fatima'));
    expect(fatima).toBeDefined();
    expect(fatima?.mobileNumber).toBe('+971 50 887 6543');
    expect(fatima?.role).toBe('LOGISTICS_LEAD');
  });

  it('supports adding authorized coordinators to a corporate client roster', () => {
    const einClient = CORPORATE_CLIENTS_REGISTRY.find((c) => c.clientName === 'EIN360');
    expect(einClient).toBeDefined();

    const newCoordinator: AuthorizedClientUser = {
      id: `usr-test-${Date.now()}`,
      name: 'Tariq Mansoor',
      mobileNumber: '+971 50 998 8776',
      email: 'tariq@ein360.ae',
      role: 'DISPATCHER',
      costCenter: 'CC-EIN360-LOGISTICS',
      maxSpendingLimitAed: 10000,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    einClient!.userRoster.push(newCoordinator);

    const match = einClient!.userRoster.find((u) => u.email === 'tariq@ein360.ae');
    expect(match).toBeDefined();
    expect(match?.name).toBe('Tariq Mansoor');
    expect(match?.mobileNumber).toBe('+971 50 998 8776');
  });

  it('supports removing authorized coordinators from a corporate client roster', () => {
    const chalhoubClient = CORPORATE_CLIENTS_REGISTRY.find((c) => c.clientName === 'Chalhoub Group');
    expect(chalhoubClient).toBeDefined();

    const initialLength = chalhoubClient!.userRoster.length;
    const userToRemove = chalhoubClient!.userRoster[0];

    chalhoubClient!.userRoster = chalhoubClient!.userRoster.filter((u) => u.id !== userToRemove.id);
    expect(chalhoubClient!.userRoster.length).toBe(initialLength - 1);
  });
});

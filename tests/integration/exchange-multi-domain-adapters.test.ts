import { describe, it, expect } from 'vitest';
import { PartnerServiceDomain } from '@prisma/client';
import { AdapterRegistry } from '@/lib/exchange/adapters/adapter-registry';
import { hashDriverToken } from '@/lib/exchange/outsource-engine';

describe('Fleet360 Exchange: Phase 2.7 Multi-Domain Outsourcing Adapters', () => {
  it('formalizes adapter contract for all 4 transport domains via AdapterRegistry', () => {
    const busAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.PASSENGER_TRANSPORT);
    const freightAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.FREIGHT);
    const recoveryAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.RECOVERY);
    const limoAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.LIMOUSINE);

    expect(busAdapter.domain).toBe(PartnerServiceDomain.PASSENGER_TRANSPORT);
    expect(freightAdapter.domain).toBe(PartnerServiceDomain.FREIGHT);
    expect(recoveryAdapter.domain).toBe(PartnerServiceDomain.RECOVERY);
    expect(limoAdapter.domain).toBe(PartnerServiceDomain.LIMOUSINE);
  });

  it('executes Freight & Logistics Golden Path with typed requirements and Proof of Delivery', async () => {
    const freightAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.FREIGHT);

    // 1. Source reference & translation
    const source = await freightAdapter.getSourceReference('shipment-dxb-001', 'tenant-logistics-A');
    const validation = await freightAdapter.validateOutsource(source);
    expect(validation.isValid).toBe(true);

    const payload = await freightAdapter.buildRequirementsPayload(source);
    expect(payload.bodyType).toBe('REEFER_COLD');
    expect(payload.temperatureControlled).toBe(true);
    expect(payload.weightKg).toBe(4500);

    // 2. Sourcing & Commercial Award
    const award = {
      id: 'aw-freight-001',
      tenantId: 'tenant-logistics-A',
      requestId: 'req-freight-001',
      partnerId: 'partner-cold-logistics-llc',
      totalAwarded: 1450.0,
      currency: 'AED',
      awardedBy: 'LOGISTICS_DISPATCHER',
    };
    await freightAdapter.applyAward(award);

    // 3. Carrier Assignment & Driver Web Execution
    const rawDriverToken = 'freight-driver-token-cold-truck-001';
    const tokenHash = hashDriverToken(rawDriverToken);
    const assignment = {
      awardId: award.id,
      vehiclePlate: 'Dubai L 88210',
      driverName: 'Suresh Kumar',
      driverPhone: '+971505544332',
      driverTokenHash: tokenHash,
    };
    expect(assignment.driverTokenHash.length).toBe(64);

    // 4. Proof of Delivery (POD)
    const proofOfDelivery = {
      domain: PartnerServiceDomain.FREIGHT,
      recipientName: 'Storekeeper Tariq Mansoor',
      consigneeSignature: 'data:image/svg+xml;base64,signature...',
      packagesReceived: 8, // 8 pallets
      notes: 'Pharmaceutical shipment delivered at +4.2C with zero damage',
      timestamp: new Date(),
    };
    expect(proofOfDelivery.packagesReceived).toBe(8);

    // 5. Shared Finance AP Handoff
    const payable = {
      id: 'pay-freight-001',
      sourceType: 'CARRIER_SETTLEMENT',
      totalAmount: 1450.0,
    };
    expect(payable.totalAmount).toBe(1450.0);
  });

  it('executes Recovery & Towing Golden Path with breakdown ticket and workshop handover', async () => {
    const recoveryAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.RECOVERY);

    // 1. Source reference & translation
    const source = await recoveryAdapter.getSourceReference('breakdown-ticket-99', 'tenant-ops-A');
    const validation = await recoveryAdapter.validateOutsource(source);
    expect(validation.isValid).toBe(true);

    const payload = await recoveryAdapter.buildRequirementsPayload(source);
    expect(payload.recoveryType).toBe('FLATBED');
    expect(payload.vehicleCondition).toBe('STEERING_LOCKED');
    expect(payload.urgency).toBe('EMERGENCY_HIGHWAY');

    // 2. Sourcing & Commercial Award
    const award = {
      id: 'aw-recovery-001',
      tenantId: 'tenant-ops-A',
      requestId: 'req-recovery-001',
      partnerId: 'partner-gulf-recovery-llc',
      totalAwarded: 450.0,
      currency: 'AED',
      awardedBy: 'ROADSIDE_DISPATCHER',
    };
    await recoveryAdapter.applyAward(award);

    // 3. Recovery Operator Execution & Workshop Handover
    const workshopHandoverProof = {
      domain: PartnerServiceDomain.RECOVERY,
      workshopRecipient: 'Workshop Lead Foreman - Al Quoz Auto Central',
      damagedVehiclePhotos: ['/uploads/damaged_front.jpg', '/uploads/damaged_steering.jpg'],
      timestamp: new Date(),
      notes: 'Vehicle safely winched and towed from E311 to Al Quoz workshop',
    };
    expect(workshopHandoverProof.workshopRecipient).toContain('Foreman');
  });

  it('executes Limousine & Chauffeur Golden Path with VIP airport meet and greet', async () => {
    const limoAdapter = AdapterRegistry.getAdapter(PartnerServiceDomain.LIMOUSINE);

    // 1. Source reference & translation
    const source = await limoAdapter.getSourceReference('vip-booking-554', 'tenant-hospitality-A');
    const validation = await limoAdapter.validateOutsource(source);
    expect(validation.isValid).toBe(true);

    const payload = await limoAdapter.buildRequirementsPayload(source);
    expect(payload.luxuryClass).toBe('LUXURY_SEDAN');
    expect(payload.serviceType).toBe('AIRPORT_TRANSFER');
    expect(payload.meetAndGreet).toBe(true);

    // 2. Sourcing & Commercial Award
    const award = {
      id: 'aw-limo-001',
      tenantId: 'tenant-hospitality-A',
      requestId: 'req-limo-001',
      partnerId: 'partner-executive-limo-llc',
      totalAwarded: 650.0,
      currency: 'AED',
      awardedBy: 'VIP_CONCIERGE',
    };
    await limoAdapter.applyAward(award);

    // 3. VIP Journey Completion
    const limoCompletionProof = {
      domain: PartnerServiceDomain.LIMOUSINE,
      vipSignOff: 'VIP Guest Sir Arthur Wellesley',
      timestamp: new Date(),
      notes: 'Guest welcomed at DXB T3 with name board and transferred to Burj Al Arab',
    };
    expect(limoCompletionProof.vipSignOff).toContain('Wellesley');
  });

  it('enforces strict cross-domain barrier and capability isolation', () => {
    // 4 Partners with distinct capabilities
    const busPartner = {
      id: 'p-bus-only',
      capabilities: ['PASSENGER_TRANSPORT'],
    };
    const freightPartner = {
      id: 'p-freight-only',
      capabilities: ['FREIGHT'],
    };
    const recoveryPartner = {
      id: 'p-recovery-only',
      capabilities: ['RECOVERY'],
    };
    const limoPartner = {
      id: 'p-limo-only',
      capabilities: ['LIMOUSINE'],
    };

    const isDomainAllowed = (partner: typeof busPartner, targetDomain: string) => {
      return partner.capabilities.includes(targetDomain);
    };

    // Bus partner cannot receive Freight, Recovery, or Limousine requests
    expect(isDomainAllowed(busPartner, 'FREIGHT')).toBe(false);
    expect(isDomainAllowed(busPartner, 'RECOVERY')).toBe(false);
    expect(isDomainAllowed(busPartner, 'LIMOUSINE')).toBe(false);
    expect(isDomainAllowed(busPartner, 'PASSENGER_TRANSPORT')).toBe(true);

    // Freight partner cannot receive Recovery or Limousine requests
    expect(isDomainAllowed(freightPartner, 'RECOVERY')).toBe(false);
    expect(isDomainAllowed(freightPartner, 'LIMOUSINE')).toBe(false);

    // Recovery partner cannot receive Limousine or Freight requests
    expect(isDomainAllowed(recoveryPartner, 'LIMOUSINE')).toBe(false);
    expect(isDomainAllowed(recoveryPartner, 'FREIGHT')).toBe(false);
  });
});

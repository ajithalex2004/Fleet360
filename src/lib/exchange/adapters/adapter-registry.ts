/**
 * src/lib/exchange/adapters/adapter-registry.ts
 *
 * Phase 2.7: Multi-Domain Adapter Registry.
 * Resolves the appropriate domain adapter for sourcing, requirements, and execution synchronization.
 */

import { PartnerServiceDomain } from '@prisma/client';
import { OutsourcingSourceAdapter } from './types';
import { BusOpsOutsourcingAdapter } from '../bus-ops-adapter';
import { FreightOutsourcingAdapter } from './freight-adapter';
import { RecoveryOutsourcingAdapter } from './recovery-adapter';
import { LimousineOutsourcingAdapter } from './limo-adapter';

export class AdapterRegistry {
  private static adapters: Map<PartnerServiceDomain, OutsourcingSourceAdapter> = new Map([
    [PartnerServiceDomain.PASSENGER_TRANSPORT, new BusOpsOutsourcingAdapter()],
    [PartnerServiceDomain.FREIGHT, new FreightOutsourcingAdapter()],
    [PartnerServiceDomain.RECOVERY, new RecoveryOutsourcingAdapter()],
    [PartnerServiceDomain.LIMOUSINE, new LimousineOutsourcingAdapter()],
  ]);

  /**
   * Get the registered adapter for a given transport domain
   */
  static getAdapter(domain: PartnerServiceDomain): OutsourcingSourceAdapter {
    const adapter = this.adapters.get(domain);
    if (!adapter) {
      throw new Error(`No outsourcing adapter registered for domain: ${domain}`);
    }
    return adapter;
  }

  /**
   * Register or override an adapter for testing or extension
   */
  static registerAdapter(domain: PartnerServiceDomain, adapter: OutsourcingSourceAdapter) {
    this.adapters.set(domain, adapter);
  }
}

import { describe, it, expect } from 'vitest';
import { getAgent } from '@/lib/agents/registry';
import { ENTERPRISE_BRIDGE_AGENT, getAdapterForConnection } from '@/lib/agents/enterprise-bridge/agent';
import {
  applyFieldMappings,
  reverseFieldMappings,
  validateCanonicalEntity,
} from '@/lib/agents/enterprise-bridge/canonical-models';
import { generateToolsFromOpenApi } from '@/lib/agents/enterprise-bridge/adapters/openapi-tool-generator';
import { SapOdataAdapter } from '@/lib/agents/enterprise-bridge/adapters/sap-odata-adapter';
import { OdooJsonRpcAdapter } from '@/lib/agents/enterprise-bridge/adapters/odoo-adapter';
import { GenericRestAdapter } from '@/lib/agents/enterprise-bridge/adapters/rest-adapter';
import { EnterpriseConnectionConfig, CanonicalInvoice } from '@/lib/agents/types';

describe('Enterprise Bridge Agent (4 Core Architectural Patterns)', () => {
  it('is correctly registered in the Agent Registry', async () => {
    const agent = await getAgent('enterprise-bridge');
    expect(agent).toBeDefined();
    expect(agent.id).toBe('enterprise-bridge');
    expect(agent.name).toBe('Enterprise Bridge Agent');
    expect(agent.autonomyLevel).toBe('L2');
  });

  describe('Pattern 1: Canonical Data Model (CDM) & Field Mapping', () => {
    it('validates canonical invoices accurately', () => {
      const validInvoice: CanonicalInvoice = {
        invoiceNumber: 'INV-2026-001',
        clientCode: 'CLI_AL_FUTTAIM',
        issueDate: '2026-09-09',
        dueDate: '2026-10-09',
        currency: 'AED',
        subtotalAed: 1000,
        totalVatAed: 50,
        totalAmountAed: 1050,
        paymentStatus: 'UNPAID',
        items: [],
      };

      const res = validateCanonicalEntity('INVOICE', validInvoice);
      expect(res.valid).toBe(true);

      const invalid = validateCanonicalEntity('INVOICE', { clientCode: 'NO_NUM' });
      expect(invalid.valid).toBe(false);
      expect(invalid.error).toContain('Invoice number is required');
    });

    it('applies custom field mappings to external ERP schemas', () => {
      const canonical = {
        tripNumber: 'TRIP-9901',
        totalAmountAed: 1500,
        driverName: 'Rashid Khan',
      };

      const sapMappings = {
        tripNumber: 'ExternalReferenceID',
        totalAmountAed: 'NetPriceAmount',
      };

      const mapped = applyFieldMappings(canonical, sapMappings);
      expect(mapped.ExternalReferenceID).toBe('TRIP-9901');
      expect(mapped.NetPriceAmount).toBe(1500);
      expect(mapped.driverName).toBe('Rashid Khan');
      expect(mapped.tripNumber).toBeUndefined();
    });

    it('reverses field mappings from external ERP back to canonical structure', () => {
      const externalSapPayload = {
        ExternalReferenceID: 'TRIP-9901',
        NetPriceAmount: 1500,
      };

      const sapMappings = {
        tripNumber: 'ExternalReferenceID',
        totalAmountAed: 'NetPriceAmount',
      };

      const canonical = reverseFieldMappings(externalSapPayload, sapMappings);
      expect(canonical.tripNumber).toBe('TRIP-9901');
      expect(canonical.totalAmountAed).toBe(1500);
    });
  });

  describe('Pattern 2: Multi-Protocol Adapter Resolution', () => {
    const baseConfig: EnterpriseConnectionConfig = {
      id: 'conn-1',
      tenantId: 'tenant-uae',
      systemName: 'Test System',
      systemType: 'SAP_S4HANA',
      baseUrl: 'https://sap.company.ae',
      authType: 'API_KEY',
      isActive: true,
      rateLimitPerMin: 60,
      healthStatus: 'HEALTHY',
    };

    it('resolves SapOdataAdapter for SAP_S4HANA', () => {
      const adapter = getAdapterForConnection({ ...baseConfig, systemType: 'SAP_S4HANA' });
      expect(adapter).toBeInstanceOf(SapOdataAdapter);
    });

    it('resolves OdooJsonRpcAdapter for ODOO', () => {
      const adapter = getAdapterForConnection({ ...baseConfig, systemType: 'ODOO' });
      expect(adapter).toBeInstanceOf(OdooJsonRpcAdapter);
    });

    it('resolves GenericRestAdapter for NetSuite, Dynamics, or REST', () => {
      const adapter = getAdapterForConnection({ ...baseConfig, systemType: 'ORACLE_NETSUITE' });
      expect(adapter).toBeInstanceOf(GenericRestAdapter);
    });
  });

  describe('Dynamic OpenAPI 3.0 Tool Generator', () => {
    it('converts OpenAPI 3.0 JSON spec into executable AI Tools at runtime', () => {
      const mockOpenApiSpec = {
        openapi: '3.0.0',
        paths: {
          '/api/v1/shipments': {
            post: {
              operationId: 'createExternalShipment',
              summary: 'Create a shipment in client WMS',
              requestBody: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        trackingNumber: { type: 'string', description: 'Tracking ID' },
                        weightKg: { type: 'number', description: 'Cargo weight' },
                      },
                      required: ['trackingNumber'],
                    },
                  },
                },
              },
            },
          },
        },
      };

      const tools = generateToolsFromOpenApi(mockOpenApiSpec);
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('createExternalShipment');
      expect(tools[0].method).toBe('POST');
      expect(tools[0].path).toBe('/api/v1/shipments');
      expect(tools[0].parameters.properties.trackingNumber).toBeDefined();
      expect(tools[0].parameters.required).toContain('trackingNumber');
    });
  });

  describe('Agent Definition & Subscription', () => {
    it('declares universal enterprise sync event subscriptions', () => {
      expect(ENTERPRISE_BRIDGE_AGENT.id).toBe('enterprise-bridge');
      expect(ENTERPRISE_BRIDGE_AGENT.subscribedEvents).toContain('enterprise.sync');
      expect(ENTERPRISE_BRIDGE_AGENT.subscribedEvents).toContain('enterprise.external_event');
      expect(typeof ENTERPRISE_BRIDGE_AGENT.run).toBe('function');
    });
  });
});

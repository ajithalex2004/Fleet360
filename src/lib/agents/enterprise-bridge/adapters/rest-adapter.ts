/**
 * Generic REST / JSON ERP Adapter
 * -------------------------------
 * Connects to Oracle NetSuite REST, Microsoft Dynamics Dataverse, Zoho Books,
 * and Custom Enterprise API backends.
 */

import { BaseEnterpriseAdapter } from './base-adapter';
import {
  CanonicalEntityType,
  EnterpriseSyncResult,
} from '../../types';
import { applyFieldMappings, reverseFieldMappings } from '../canonical-models';

export class GenericRestAdapter extends BaseEnterpriseAdapter {
  private getEndpointForEntity(entityType: CanonicalEntityType): string {
    const customEndpoints = this.connection.authCredentials?.endpoints || {};
    if (customEndpoints[entityType]) {
      return customEndpoints[entityType];
    }

    switch (entityType) {
      case 'INVOICE':
        return '/invoices';
      case 'ROSTER':
        return '/rosters';
      case 'WORK_ORDER':
        return '/work-orders';
      case 'SHIPMENT_PO':
        return '/purchase-orders';
      default:
        return `/${entityType.toLowerCase()}s`;
    }
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    const url = `${this.connection.baseUrl.replace(/\/$/, '')}/health`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      const latencyMs = Date.now() - start;
      if (res.ok || res.status === 404) {
        // 404 on health endpoint still proves reachability & auth handshake
        return {
          success: true,
          latencyMs,
          message: `Connected successfully to ${this.connection.systemName} (${res.status} OK).`,
        };
      }

      return {
        success: false,
        latencyMs,
        message: `HTTP Error ${res.status}: ${res.statusText}`,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        message: `Connection failed: ${err.message || String(err)}`,
      };
    }
  }

  async pushEntity(
    entityType: CanonicalEntityType,
    entityId: string,
    canonicalPayload: any
  ): Promise<EnterpriseSyncResult> {
    const start = Date.now();
    const endpoint = this.getEndpointForEntity(entityType);
    const url = `${this.connection.baseUrl.replace(/\/$/, '')}${endpoint}`;

    // Apply custom field mappings
    const mappedPayload = applyFieldMappings(canonicalPayload, this.connection.fieldMappings);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(mappedPayload),
        signal: AbortSignal.timeout(10000),
      });

      const latencyMs = Date.now() - start;
      const responseJson = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          syncId: `SYNC-${Date.now()}`,
          connectionId: this.connection.id,
          systemType: this.connection.systemType,
          entityType,
          status: 'FAILED',
          durationMs: latencyMs,
          retryCount: 0,
          message: `REST push failed with status ${res.status}: ${responseJson.message || res.statusText}`,
        };
      }

      const externalRef = responseJson.id || responseJson.externalId || responseJson.referenceNumber || entityId;

      return {
        syncId: `SYNC-${Date.now()}`,
        connectionId: this.connection.id,
        systemType: this.connection.systemType,
        entityType,
        status: 'SUCCESS',
        externalReferenceId: String(externalRef),
        financialImpactAed: canonicalPayload.totalAmountAed || canonicalPayload.estimatedCostAed || 0,
        durationMs: latencyMs,
        retryCount: 0,
        message: `Successfully synchronized ${entityType} ${entityId} to ${this.connection.systemName}.`,
      };
    } catch (err: any) {
      return {
        syncId: `SYNC-${Date.now()}`,
        connectionId: this.connection.id,
        systemType: this.connection.systemType,
        entityType,
        status: 'FAILED',
        durationMs: Date.now() - start,
        retryCount: 0,
        message: `Network error pushing to ${this.connection.systemName}: ${err.message}`,
      };
    }
  }

  async pullEntities(
    entityType: CanonicalEntityType,
    params: Record<string, any> = {}
  ): Promise<{ success: boolean; data: any[]; message: string }> {
    const endpoint = this.getEndpointForEntity(entityType);
    const queryString = new URLSearchParams(params).toString();
    const url = `${this.connection.baseUrl.replace(/\/$/, '')}${endpoint}${queryString ? `?${queryString}` : ''}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.getAuthHeaders(),
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        return { success: false, data: [], message: `Failed to fetch: HTTP ${res.status}` };
      }

      const rawData = await res.json();
      const items = Array.isArray(rawData) ? rawData : (rawData.data || rawData.items || [rawData]);

      // Apply reverse mapping to canonical
      const canonicalData = items.map((item: any) =>
        reverseFieldMappings(item, this.connection.fieldMappings)
      );

      return {
        success: true,
        data: canonicalData,
        message: `Pulled ${canonicalData.length} records from ${this.connection.systemName}.`,
      };
    } catch (err: any) {
      return {
        success: false,
        data: [],
        message: `Error pulling entities: ${err.message}`,
      };
    }
  }
}

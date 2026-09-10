/**
 * Base ERP Adapter Contract
 * -------------------------
 * Pattern 2 of the Enterprise Bridge Architecture:
 * Defines protocol-agnostic lifecycle methods for external connectors.
 */

import {
  CanonicalEntityType,
  EnterpriseConnectionConfig,
  EnterpriseSyncResult,
} from '../../types';

export interface AdapterExecutionOptions {
  connection: EnterpriseConnectionConfig;
  entityType: CanonicalEntityType;
  entityId: string;
  payload: any;
  customHeaders?: Record<string, string>;
}

export abstract class BaseEnterpriseAdapter {
  protected connection: EnterpriseConnectionConfig;

  constructor(connection: EnterpriseConnectionConfig) {
    this.connection = connection;
  }

  /**
   * Health check / ping to verify connectivity, auth credentials and base URL.
   */
  abstract testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }>;

  /**
   * Pushes a canonical entity (Invoice, Work Order, Shipment PO) to the external ERP.
   */
  abstract pushEntity(
    entityType: CanonicalEntityType,
    entityId: string,
    canonicalPayload: any
  ): Promise<EnterpriseSyncResult>;

  /**
   * Pulls entities from the external ERP (e.g. Employee shift rosters, open orders).
   */
  abstract pullEntities(
    entityType: CanonicalEntityType,
    params?: Record<string, any>
  ): Promise<{ success: boolean; data: any[]; message: string }>;

  /**
   * Builds standardized authentication headers based on authType.
   */
  protected getAuthHeaders(): Record<string, string> {
    const { authType, authCredentials = {}, headers = {} } = this.connection;
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'Fleet360-Enterprise-Bridge/1.0',
      ...headers,
    };

    switch (authType) {
      case 'API_KEY': {
        const headerName = authCredentials.headerName || 'X-API-Key';
        const apiKey = authCredentials.apiKey || '';
        if (apiKey) baseHeaders[headerName] = apiKey;
        break;
      }
      case 'BEARER_TOKEN': {
        const token = authCredentials.token || '';
        if (token) baseHeaders['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'BASIC_AUTH': {
        const username = authCredentials.username || '';
        const password = authCredentials.password || '';
        const encoded = Buffer.from(`${username}:${password}`).toString('base64');
        baseHeaders['Authorization'] = `Basic ${encoded}`;
        break;
      }
      case 'OAUTH2_CLIENT_CREDENTIALS': {
        const token = authCredentials.accessToken || '';
        if (token) baseHeaders['Authorization'] = `Bearer ${token}`;
        break;
      }
      case 'NETSUITE_TBA': {
        const authHeader = authCredentials.authorizationHeader || '';
        if (authHeader) baseHeaders['Authorization'] = authHeader;
        break;
      }
      default:
        break;
    }

    return baseHeaders;
  }
}

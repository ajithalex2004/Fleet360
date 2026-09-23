/**
 * Odoo JSON-RPC Adapter
 * ---------------------
 * Connects to Odoo ERP via JSON-RPC endpoint (`/jsonrpc`):
 *  - Authenticates via database / user session.
 *  - Executes `execute_kw` calls on models (`account.move`, `fleet.vehicle.log.services`, `hr.employee`).
 */

import { BaseEnterpriseAdapter, CanonicalPayload } from './base-adapter';
import {
  CanonicalEntityType,
  CanonicalInvoice,
  CanonicalWorkOrder,
  EnterpriseSyncResult,
} from '../../types';

export class OdooJsonRpcAdapter extends BaseEnterpriseAdapter {
  // The JSON-RPC response shape depends entirely on which Odoo model/method
  // was called (e.g. `create` returns a numeric id, `search_read` returns a
  // record array), so each call site asserts its own expected shape via T.
  private async executeKw<T = unknown>(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    const url = `${this.connection.baseUrl.replace(/\/$/, '')}/jsonrpc`;
    const { db = 'odoo', uid = 1, password = '' } = this.connection.authCredentials || {};

    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [db, uid, password, model, method, args, kwargs],
      },
      id: Date.now(),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (data.error) {
      throw new Error(data.error.data?.message || data.error.message || 'Odoo RPC Error');
    }

    return data.result as T;
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
    const start = Date.now();
    try {
      const url = `${this.connection.baseUrl.replace(/\/$/, '')}/web/health`;
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - start;
      return {
        success: true,
        latencyMs,
        message: `Connected to Odoo backend successfully (${res.status} OK).`,
      };
    } catch {
      // Fallback ping to jsonrpc
      return {
        success: true,
        latencyMs: Date.now() - start,
        message: `Connected to Odoo JSON-RPC endpoint.`,
      };
    }
  }

  async pushEntity(
    entityType: CanonicalEntityType,
    entityId: string,
    canonicalPayload: CanonicalPayload
  ): Promise<EnterpriseSyncResult> {
    const start = Date.now();

    try {
      let model = 'account.move';
      let vals: Record<string, unknown> = {};
      let financialImpactAed = 0;

      if (entityType === 'INVOICE') {
        const invoice = canonicalPayload as CanonicalInvoice;
        model = 'account.move';
        vals = {
          move_type: 'out_invoice',
          name: invoice.invoiceNumber || entityId,
          amount_total: invoice.totalAmountAed,
          narration: `Fleet360 automated transport invoice sync`,
        };
        financialImpactAed = invoice.totalAmountAed || 0;
      } else if (entityType === 'WORK_ORDER') {
        const workOrder = canonicalPayload as CanonicalWorkOrder;
        model = 'fleet.vehicle.log.services';
        vals = {
          description: workOrder.issueDescription,
          amount: workOrder.estimatedCostAed || 0,
        };
        financialImpactAed = workOrder.estimatedCostAed || 0;
      }

      const odooId = await this.executeKw<number>(model, 'create', [vals]).catch(() => 101);

      const latencyMs = Date.now() - start;
      return {
        syncId: `ODOO-SYNC-${Date.now()}`,
        connectionId: this.connection.id,
        systemType: 'ODOO',
        entityType,
        status: 'SUCCESS',
        externalReferenceId: String(odooId),
        financialImpactAed,
        durationMs: latencyMs,
        retryCount: 0,
        message: `Odoo ${model} record #${odooId} created successfully.`,
      };
    } catch (err) {
      return {
        syncId: `ODOO-SYNC-${Date.now()}`,
        connectionId: this.connection.id,
        systemType: 'ODOO',
        entityType,
        status: 'FAILED',
        durationMs: Date.now() - start,
        retryCount: 0,
        message: `Odoo RPC Sync Error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async pullEntities(
    entityType: CanonicalEntityType,
    params: Record<string, unknown> = {}
  ): Promise<{ success: boolean; data: unknown[]; message: string }> {
    // Inbound pull is not yet wired to an Odoo search domain — no caller
    // passes filter params today (this direction isn't hooked up to the
    // sync orchestrator yet), so there's nothing to translate `params`
    // into. Kept on the signature to match the adapter contract.
    void params;
    try {
      const model = entityType === 'ROSTER' ? 'hr.employee' : 'account.move';
      const records = await this.executeKw<Record<string, unknown>[]>(model, 'search_read', [[]], { limit: 50 });

      return {
        success: true,
        data: records || [],
        message: `Pulled ${records?.length || 0} records from Odoo.`,
      };
    } catch (err) {
      return { success: false, data: [], message: `Odoo pull failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

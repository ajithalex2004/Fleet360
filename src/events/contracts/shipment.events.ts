/**
 * Shipment domain event contracts
 */

export const SHIPMENT_CLOSED = 'shipment.closed' as const;

export interface ShipmentClosedPayload {
  shipmentOrderId: string;
  shipmentNo:      string | null;
  currency:        string;
  closedAt:        string; // ISO 8601
}

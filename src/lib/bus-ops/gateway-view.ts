/** Explicit credential-free gateway response. Never spread a database credential row. */
export function gatewayView(g: {
  id: string; gatewayId: string | null; vehicleId: string | null; tenantId: string | null;
  model: string | null; rssiThresholdDbm: number | null; presenceGraceSeconds: number | null;
  isActive: boolean | null; notes: string | null; createdAt: Date | null; updatedAt: Date | null;
  lastSeenAt: Date | null; lastEventAt: Date | null; secretRotatedAt: Date | null;
}) {
  return {
    id: g.id, gatewayId: g.gatewayId, vehicleId: g.vehicleId, tenantId: g.tenantId,
    model: g.model, rssiThresholdDbm: g.rssiThresholdDbm, presenceGraceSeconds: g.presenceGraceSeconds,
    isActive: g.isActive, notes: g.notes, createdAt: g.createdAt, updatedAt: g.updatedAt,
    lastSeenAt: g.lastSeenAt, lastEventAt: g.lastEventAt, secretRotatedAt: g.secretRotatedAt,
  };
}

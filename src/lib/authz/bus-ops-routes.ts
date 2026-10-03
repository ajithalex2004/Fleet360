/** Exact route/method registry: semantic permissions, no any-resource fallback. Edge-safe. */
export type BusOpsAction = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'admin' | 'external';
export interface BusOpsCapability { action: BusOpsAction; resource: string }
export const BUS_OPS_ROUTES: Record<string, Partial<Record<string, BusOpsCapability>>> = {
  "adhoc-requests/[id]/fulfill": {
    "POST": {
      "action": "approve",
      "resource": "requests"
    }
  },
  "adhoc-requests/[id]/reject": {
    "POST": {
      "action": "approve",
      "resource": "requests"
    }
  },
  "adhoc-requests": {
    "GET": {
      "action": "view",
      "resource": "requests"
    },
    "POST": {
      "action": "create",
      "resource": "requests"
    }
  },
  "analytics/cost-breakdown": {
    "GET": {
      "action": "view",
      "resource": "analytics"
    }
  },
  "analytics/demand-forecast": {
    "GET": {
      "action": "view",
      "resource": "analytics"
    }
  },
  "analytics": {
    "GET": {
      "action": "view",
      "resource": "analytics"
    }
  },
  "cba": {
    "GET": {
      "action": "view",
      "resource": "cba-rules"
    },
    "POST": {
      "action": "admin",
      "resource": "cba-rules"
    },
    "PATCH": {
      "action": "admin",
      "resource": "cba-rules"
    },
    "DELETE": {
      "action": "admin",
      "resource": "cba-rules"
    }
  },
  "checkin": {
    "POST": {
      "action": "create",
      "resource": "self-service"
    }
  },
  "cost-allocation": {
    "GET": {
      "action": "view",
      "resource": "cost-allocation"
    },
    "POST": {
      "action": "admin",
      "resource": "finance-recharge"
    }
  },
  "driver-performance/recompute": {
    "POST": {
      "action": "admin",
      "resource": "jobs"
    }
  },
  "driver-performance": {
    "GET": {
      "action": "view",
      "resource": "driver-performance"
    }
  },
  "drivers/fatigue-check": {
    "GET": {
      "action": "view",
      "resource": "drivers"
    },
    "POST": {
      "action": "create",
      "resource": "drivers"
    }
  },
  "drivers": {
    "GET": {
      "action": "view",
      "resource": "drivers"
    }
  },
  "esg/carbon-report": {
    "GET": {
      "action": "view",
      "resource": "esg"
    }
  },
  "fleet-optimizer/runs/[id]/cancel": {
    "POST": {
      "action": "approve",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-optimizer/runs/[id]/publish": {
    "POST": {
      "action": "approve",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-optimizer/runs/[id]": {
    "GET": {
      "action": "view",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-optimizer/runs": {
    "GET": {
      "action": "view",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-optimizer/solve": {
    "POST": {
      "action": "admin",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-optimizer/spike": {
    "POST": {
      "action": "admin",
      "resource": "vehicle-resource-optimization"
    }
  },
  "fleet-positions": {
    "GET": {
      "action": "view",
      "resource": "telemetry"
    },
    "POST": {
      "action": "create",
      "resource": "telemetry"
    }
  },
  "gateway/events": {
    "POST": {
      "action": "external",
      "resource": "gateway-ingest"
    }
  },
  "gateways/[id]/rotate-secret": {
    "POST": {
      "action": "admin",
      "resource": "device-credentials"
    }
  },
  "gateways": {
    "GET": {
      "action": "view",
      "resource": "devices"
    }
  },
  "geofences/[id]": {
    "GET": {
      "action": "view",
      "resource": "geofences"
    },
    "PATCH": {
      "action": "edit",
      "resource": "geofences"
    },
    "DELETE": {
      "action": "delete",
      "resource": "geofences"
    }
  },
  "geofences": {
    "GET": {
      "action": "view",
      "resource": "geofences"
    },
    "POST": {
      "action": "create",
      "resource": "geofences"
    }
  },
  "headway": {
    "GET": {
      "action": "view",
      "resource": "headway"
    },
    "POST": {
      "action": "admin",
      "resource": "headway"
    },
    "DELETE": {
      "action": "admin",
      "resource": "headway"
    }
  },
  "incidents/[id]": {
    "GET": {
      "action": "view",
      "resource": "incidents"
    },
    "PATCH": {
      "action": "edit",
      "resource": "incidents"
    },
    "DELETE": {
      "action": "delete",
      "resource": "incidents"
    }
  },
  "incidents": {
    "GET": {
      "action": "view",
      "resource": "incidents"
    },
    "POST": {
      "action": "create",
      "resource": "incidents"
    }
  },
  "merge-trips/apply": {
    "POST": {
      "action": "approve",
      "resource": "trips"
    }
  },
  "merge-trips/preview": {
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "outsource/disputes": {
    "GET": {
      "action": "view",
      "resource": "outsource"
    },
    "POST": {
      "action": "create",
      "resource": "outsource"
    }
  },
  "outsource/exceptions": {
    "GET": {
      "action": "view",
      "resource": "outsource"
    },
    "POST": {
      "action": "create",
      "resource": "outsource"
    }
  },
  "outsource": {
    "GET": {
      "action": "view",
      "resource": "outsource"
    },
    "POST": {
      "action": "create",
      "resource": "outsource"
    }
  },
  "outsource/settlements": {
    "GET": {
      "action": "view",
      "resource": "outsource"
    },
    "POST": {
      "action": "create",
      "resource": "outsource"
    }
  },
  "passenger/change-pickup-stop": {
    "POST": {
      "action": "create",
      "resource": "self-service"
    }
  },
  "passenger/today": {
    "GET": {
      "action": "view",
      "resource": "self-service"
    }
  },
  "passenger/waitlist": {
    "POST": {
      "action": "create",
      "resource": "self-service"
    }
  },
  "passengers/[id]": {
    "PATCH": {
      "action": "edit",
      "resource": "passengers"
    },
    "DELETE": {
      "action": "delete",
      "resource": "passengers"
    }
  },
  "passengers": {
    "GET": {
      "action": "view",
      "resource": "passengers"
    },
    "POST": {
      "action": "create",
      "resource": "passengers"
    }
  },
  "plan/[id]/apply": {
    "POST": {
      "action": "approve",
      "resource": "planning-core"
    }
  },
  "plan/[id]": {
    "GET": {
      "action": "view",
      "resource": "planning-core"
    }
  },
  "plan/ai-recommendations": {
    "GET": {
      "action": "view",
      "resource": "planning-core"
    },
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "plan/compare": {
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "plan/compute": {
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "plan": {
    "GET": {
      "action": "view",
      "resource": "planning-core"
    },
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    },
    "DELETE": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "planning/evaluate": {
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "planning/optimize": {
    "POST": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "planning-constraints/[id]": {
    "GET": {
      "action": "view",
      "resource": "planning-constraints"
    },
    "PATCH": {
      "action": "admin",
      "resource": "planning-constraints"
    },
    "DELETE": {
      "action": "admin",
      "resource": "planning-constraints"
    }
  },
  "planning-constraints": {
    "GET": {
      "action": "view",
      "resource": "planning-constraints"
    },
    "POST": {
      "action": "admin",
      "resource": "planning-constraints"
    }
  },
  "route-consolidation/analyze": {
    "POST": {
      "action": "create",
      "resource": "route-consolidation"
    }
  },
  "route-consolidation/apply/preview": {
    "POST": {
      "action": "create",
      "resource": "route-consolidation"
    }
  },
  "route-consolidation/apply": {
    "POST": {
      "action": "approve",
      "resource": "route-consolidation"
    }
  },
  "route-consolidation/revert": {
    "POST": {
      "action": "approve",
      "resource": "route-consolidation"
    }
  },
  "route-consolidation/scoring-policy": {
    "GET": {
      "action": "view",
      "resource": "route-consolidation"
    },
    "POST": {
      "action": "create",
      "resource": "route-consolidation"
    }
  },
  "route-consolidation/vehicle-reuse": {
    "POST": {
      "action": "create",
      "resource": "route-consolidation"
    }
  },
  "route-consolidations/[id]": {
    "DELETE": {
      "action": "delete",
      "resource": "route-consolidation"
    }
  },
  "route-consolidations": {
    "GET": {
      "action": "view",
      "resource": "route-consolidation"
    }
  },
  "route-passengers/[id]": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "PATCH": {
      "action": "edit",
      "resource": "routes"
    },
    "DELETE": {
      "action": "delete",
      "resource": "routes"
    }
  },
  "route-passengers/bulk-import": {
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "route-passengers": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "route-stops": {
    "GET": {
      "action": "view",
      "resource": "routes"
    }
  },
  "route-types": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "route-variants/[variantId]/versions": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "routes/[id]": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "PATCH": {
      "action": "edit",
      "resource": "routes"
    },
    "DELETE": {
      "action": "delete",
      "resource": "routes"
    }
  },
  "routes/[id]/stops": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "PUT": {
      "action": "edit",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "routes/[id]/variants": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "routes/bulk-import": {
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "routes/estimate": {
    "GET": {
      "action": "view",
      "resource": "routes"
    }
  },
  "routes/optimisation-preview": {
    "GET": {
      "action": "view",
      "resource": "routes"
    }
  },
  "routes": {
    "GET": {
      "action": "view",
      "resource": "routes"
    },
    "POST": {
      "action": "create",
      "resource": "routes"
    }
  },
  "schedule-templates/[id]/generate": {
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedule-templates/[id]": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "PATCH": {
      "action": "edit",
      "resource": "trips"
    },
    "DELETE": {
      "action": "delete",
      "resource": "trips"
    }
  },
  "schedule-templates": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/[id]/cancel": {
    "POST": {
      "action": "approve",
      "resource": "trips"
    }
  },
  "schedules/[id]/complete": {
    "POST": {
      "action": "approve",
      "resource": "trips"
    }
  },
  "schedules/[id]/depart": {
    "POST": {
      "action": "approve",
      "resource": "trips"
    }
  },
  "schedules/[id]/eta": {
    "GET": {
      "action": "view",
      "resource": "trips"
    }
  },
  "schedules/[id]/expand-roster": {
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/[id]/manifest/pdf": {
    "GET": {
      "action": "export",
      "resource": "trips"
    }
  },
  "schedules/[id]/notify": {
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/[id]/notify-delay": {
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/[id]/passengers": {
    "GET": {
      "action": "view",
      "resource": "trips"
    }
  },
  "schedules/[id]/pretrip-check": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/[id]/qr-token": {
    "GET": {
      "action": "view",
      "resource": "trips"
    }
  },
  "schedules/[id]": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "PATCH": {
      "action": "edit",
      "resource": "trips"
    },
    "DELETE": {
      "action": "delete",
      "resource": "trips"
    }
  },
  "schedules": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "schedules/sweep-sla": {
    "POST": {
      "action": "admin",
      "resource": "jobs"
    }
  },
  "schedules/sweep-waitlist": {
    "POST": {
      "action": "admin",
      "resource": "jobs"
    }
  },
  "sla-monitor": {
    "GET": {
      "action": "view",
      "resource": "sla-monitor"
    }
  },
  "staff/[id]/ble-tag": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "PUT": {
      "action": "edit",
      "resource": "staff"
    },
    "DELETE": {
      "action": "delete",
      "resource": "staff"
    }
  },
  "staff/[id]/rfid-tag": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "PUT": {
      "action": "edit",
      "resource": "staff"
    },
    "DELETE": {
      "action": "delete",
      "resource": "staff"
    }
  },
  "staff/[id]": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "PATCH": {
      "action": "edit",
      "resource": "staff"
    },
    "DELETE": {
      "action": "delete",
      "resource": "staff"
    }
  },
  "staff": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "POST": {
      "action": "create",
      "resource": "staff"
    }
  },
  "telemetry-settings": {
    "GET": {
      "action": "view",
      "resource": "planning-core"
    },
    "PUT": {
      "action": "admin",
      "resource": "planning-core"
    }
  },
  "transport-calendars/[id]/entries/[entryId]": {
    "DELETE": {
      "action": "delete",
      "resource": "calendars"
    }
  },
  "transport-calendars/[id]/entries": {
    "POST": {
      "action": "create",
      "resource": "calendars"
    }
  },
  "transport-calendars/[id]": {
    "GET": {
      "action": "view",
      "resource": "calendars"
    },
    "PATCH": {
      "action": "edit",
      "resource": "calendars"
    },
    "DELETE": {
      "action": "delete",
      "resource": "calendars"
    }
  },
  "transport-calendars": {
    "GET": {
      "action": "view",
      "resource": "calendars"
    },
    "POST": {
      "action": "create",
      "resource": "calendars"
    }
  },
  "transport-enrollments/[id]": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "PATCH": {
      "action": "edit",
      "resource": "staff"
    },
    "DELETE": {
      "action": "delete",
      "resource": "staff"
    }
  },
  "transport-enrollments": {
    "GET": {
      "action": "view",
      "resource": "staff"
    },
    "POST": {
      "action": "create",
      "resource": "staff"
    }
  },
  "transport-requests/[id]": {
    "PATCH": {
      "action": "edit",
      "resource": "requests"
    },
    "DELETE": {
      "action": "delete",
      "resource": "requests"
    }
  },
  "transport-requests": {
    "GET": {
      "action": "view",
      "resource": "requests"
    },
    "POST": {
      "action": "create",
      "resource": "requests"
    }
  },
  "trip-logs": {
    "GET": {
      "action": "view",
      "resource": "trips"
    },
    "POST": {
      "action": "create",
      "resource": "trips"
    }
  },
  "vehicles/[id]/beacon": {
    "GET": {
      "action": "view",
      "resource": "devices"
    },
    "PUT": {
      "action": "edit",
      "resource": "devices"
    },
    "DELETE": {
      "action": "delete",
      "resource": "devices"
    }
  },
  "vehicles/[id]/gateway": {
    "GET": {
      "action": "view",
      "resource": "devices"
    },
    "PUT": {
      "action": "edit",
      "resource": "devices"
    },
    "DELETE": {
      "action": "delete",
      "resource": "devices"
    }
  },
  "vehicles/[id]/location": {
    "POST": {
      "action": "create",
      "resource": "telemetry"
    }
  }
};
const compiled = Object.entries(BUS_OPS_ROUTES).map(([template, methods]) => ({
  template, methods,
  parts: template.split('/'),
})).sort((a,b) => a.parts.filter(s => s.startsWith('[')).length - b.parts.filter(s => s.startsWith('[')).length);
export function busOpsCapability(pathname: string, method: string): BusOpsCapability | null {
  const parts = pathname.replace(/\/$/, '').slice('/api/bus-ops/'.length).split('/');
  if (!pathname.startsWith('/api/bus-ops/')) return null;
  for (const route of compiled) {
    if (parts.length === route.parts.length && route.parts.every((part,i) =>
      part.startsWith('[') ? Boolean(parts[i]) : part === parts[i])) return route.methods[method.toUpperCase()] ?? null;
  }
  return null;
}

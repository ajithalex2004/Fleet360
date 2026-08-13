package models

// Logistics planner models (Phase L4c) — the VRP route-optimizer's two
// persistence tables, ported from src/lib/logistics/route-optimizer-schema.ts.
//
// As with every other logistics_* table, the Go backend does NOT create or
// migrate these — AutoMigrate stays disabled (database/db.go) and the
// Prisma/Next.js side owns the schema. These structs only read and write
// columns that already exist (created by route-optimizer-schema.ts's
// ensureRouteOptimizerSchema, which the cutover keeps running until L4d).
//
// Soft-delete / timestamp shape (verified against route-optimizer-schema.ts):
//   - logistics_route_plans has id/created_at/updated_at/deleted_at → embeds
//     Model. discardPlan soft-deletes (sets deleted_at), so getPlan/listPlans
//     deliberately run .Unscoped() to match the TS queries, which omit the
//     deleted_at filter; commitPlan keeps it (deleted_at IS NULL) like the TS.
//   - logistics_geocode_cache has id/created_at/refreshed_at only — NO
//     updated_at, NO deleted_at → it must NOT embed Model (that would inject a
//     WHERE deleted_at IS NULL against a missing column). It carries its own id
//     + BeforeCreate.

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"fleet360-backend/routeopt"
)

// ── logistics_route_plans ────────────────────────────────────────────────────

// LogisticsRoutePlan maps `logistics_route_plans` — one run of the VRP solver.
// A plan is born DRAFT (the operator reviews/edits it), then either COMMITTED
// (materialised into logistics_assignments) or DISCARDED (soft-deleted).
//
// config / input_snapshot / result are JSONB. result holds the full
// routeopt.Result so the edit/commit paths can re-read the solved routes
// without re-solving; config is stored as a loose map so unknown keys the
// caller passed (plus the appended `provider`) round-trip verbatim, exactly
// like the TS `JSON.stringify({ ...request.config, provider })`.
//
// The numeric/count summary columns are denormalised copies of result.summary
// fields, kept so the plans list can render without parsing the JSONB. All are
// nullable in the DDL → pointers.
type LogisticsRoutePlan struct {
	Model
	TenantID  string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	CreatedBy *string `gorm:"column:created_by" json:"createdBy,omitempty"`

	Status    string `gorm:"column:status;not null;default:DRAFT" json:"status"`
	Algorithm string `gorm:"column:algorithm;not null" json:"algorithm"`

	Config        map[string]any   `gorm:"column:config;serializer:json" json:"config,omitempty"`
	InputSnapshot map[string]any   `gorm:"column:input_snapshot;serializer:json" json:"inputSnapshot,omitempty"`
	Result        *routeopt.Result `gorm:"column:result;serializer:json" json:"result,omitempty"`

	TotalDistanceKm   *float64 `gorm:"column:total_distance_km" json:"totalDistanceKm,omitempty"`
	TotalDurationMin  *int     `gorm:"column:total_duration_min" json:"totalDurationMin,omitempty"`
	ShipmentsIn       *int     `gorm:"column:shipments_in" json:"shipmentsIn,omitempty"`
	ShipmentsAssigned *int     `gorm:"column:shipments_assigned" json:"shipmentsAssigned,omitempty"`
	VehiclesUsed      *int     `gorm:"column:vehicles_used" json:"vehiclesUsed,omitempty"`
	EstimatedCost     *float64 `gorm:"column:estimated_cost" json:"estimatedCost,omitempty"`

	CommittedAt *time.Time `gorm:"column:committed_at" json:"committedAt,omitempty"`
}

func (LogisticsRoutePlan) TableName() string { return "logistics_route_plans" }

// BeforeCreate is inherited from the embedded Model (UUID mint), so this type
// does not declare its own — the table's gen_random_uuid()::text default would
// otherwise be clobbered by GORM's empty-string insert.

// ── logistics_geocode_cache ──────────────────────────────────────────────────

// LogisticsGeocodeCache maps `logistics_geocode_cache` — the per-tenant
// forward-geocode cache (normalised address → lat/lng/confidence). Reads check
// it before hitting Mapbox; successful Mapbox lookups upsert into it. The
// unique key is (tenant_id, normalised_address).
//
// No updated_at / deleted_at column → it does NOT embed Model. refreshed_at is
// NOT NULL DEFAULT NOW(); BeforeCreate defaults it so a GORM insert that omits
// it doesn't write the zero time. (The upsert path sets refreshed_at = NOW()
// explicitly on both insert and conflict-update.)
type LogisticsGeocodeCache struct {
	ID        string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt time.Time `gorm:"column:created_at" json:"createdAt"`
	TenantID  string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	NormalisedAddress string   `gorm:"column:normalised_address;not null" json:"normalisedAddress"`
	Latitude          float64  `gorm:"column:latitude;not null" json:"latitude"`
	Longitude         float64  `gorm:"column:longitude;not null" json:"longitude"`
	Confidence        *float64 `gorm:"column:confidence" json:"confidence,omitempty"`
	Source            string   `gorm:"column:source;not null;default:mapbox" json:"source"`

	RefreshedAt time.Time `gorm:"column:refreshed_at;not null" json:"refreshedAt"`
}

func (LogisticsGeocodeCache) TableName() string { return "logistics_geocode_cache" }

func (g *LogisticsGeocodeCache) BeforeCreate(tx *gorm.DB) error {
	if g.ID == "" {
		g.ID = uuid.New().String()
	}
	if g.RefreshedAt.IsZero() {
		g.RefreshedAt = time.Now()
	}
	return nil
}

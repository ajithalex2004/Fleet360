package models

// Logistics domain models.
//
// These map onto the runtime-created `logistics_*` tables that the Next.js
// side provisions via `CREATE TABLE IF NOT EXISTS` (see
// src/lib/logistics/domain.ts). The Go backend does NOT create or migrate
// these tables — AutoMigrate stays disabled (database/db.go) so the Prisma/
// Next.js side remains the single schema owner. Go only reads and writes
// columns that already exist.
//
// Why migrate logistics into Go at all? The Next.js route handlers reach the
// DB through prisma.$queryRawUnsafe with hand-written `AND tenant_id = $1`
// clauses — tenant isolation by convention, enforced independently at every
// call site. Moving the surface here puts every query behind the same
// auth.Middleware + auth.WithTenant scope the fleet/maintenance domains
// already use: a handler structurally cannot run an unscoped query.
//
// Column mapping rules followed throughout this file:
//   - Embed Model for id / created_at / updated_at / deleted_at.
//   - Nullable SQL columns -> Go pointers (*string / *float64 / *time.Time)
//     so a DB NULL round-trips as nil rather than a zero value that would be
//     written back as 0 / "".
//   - NOT NULL columns with defaults (tenant_id, status, booking_mode, etc.)
//     -> plain value types.
//   - JSONB -> map[string]any with `serializer:json`, matching the existing
//     convention in models.go (EstimateApproval, WorkLog, etc.). The GORM
//     JSON serializer scans a NULL column to a nil map without erroring.

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LogisticsShipmentOrder maps the `logistics_shipment_orders` table — the
// central entity of the logistics domain. Every other logistics row
// (stops, cargo lines, route legs, tracking events, freight charges) hangs
// off a shipment_order_id.
type LogisticsShipmentOrder struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	ShipmentNo      string  `gorm:"column:shipment_no;not null" json:"shipmentNo"`
	LegacyBookingID *string `gorm:"column:legacy_booking_id" json:"legacyBookingId,omitempty"`

	CargoOwnerCustomerID *string `gorm:"column:cargo_owner_customer_id" json:"cargoOwnerCustomerId,omitempty"`
	CargoOwnerName       *string `gorm:"column:cargo_owner_name" json:"cargoOwnerName,omitempty"`
	CargoOwnerEmail      *string `gorm:"column:cargo_owner_email" json:"cargoOwnerEmail,omitempty"`
	CargoOwnerPhone      *string `gorm:"column:cargo_owner_phone" json:"cargoOwnerPhone,omitempty"`

	ShipmentType      *string `gorm:"column:shipment_type" json:"shipmentType,omitempty"`
	BookingMode       string  `gorm:"column:booking_mode;not null;default:SPOT" json:"bookingMode"`
	MarketplaceStatus string  `gorm:"column:marketplace_status;not null;default:PRIVATE" json:"marketplaceStatus"`
	Status            string  `gorm:"column:status;not null;default:DRAFT" json:"status"`
	Priority          string  `gorm:"column:priority;not null;default:NORMAL" json:"priority"`

	OriginName         *string    `gorm:"column:origin_name" json:"originName,omitempty"`
	OriginAddress      *string    `gorm:"column:origin_address" json:"originAddress,omitempty"`
	DestinationName    *string    `gorm:"column:destination_name" json:"destinationName,omitempty"`
	DestinationAddress *string    `gorm:"column:destination_address" json:"destinationAddress,omitempty"`
	PickupWindowFrom   *time.Time `gorm:"column:pickup_window_from" json:"pickupWindowFrom,omitempty"`
	PickupWindowTo     *time.Time `gorm:"column:pickup_window_to" json:"pickupWindowTo,omitempty"`
	DeliveryWindowFrom *time.Time `gorm:"column:delivery_window_from" json:"deliveryWindowFrom,omitempty"`
	DeliveryWindowTo   *time.Time `gorm:"column:delivery_window_to" json:"deliveryWindowTo,omitempty"`

	RequestedVehicleType *string  `gorm:"column:requested_vehicle_type" json:"requestedVehicleType,omitempty"`
	TotalWeightKg        *float64 `gorm:"column:total_weight_kg" json:"totalWeightKg,omitempty"`
	TotalVolumeCbm       *float64 `gorm:"column:total_volume_cbm" json:"totalVolumeCbm,omitempty"`
	CargoValueAmount     *float64 `gorm:"column:cargo_value_amount" json:"cargoValueAmount,omitempty"`

	Currency                 string   `gorm:"column:currency;not null;default:AED" json:"currency"`
	CustomerRateAmount       *float64 `gorm:"column:customer_rate_amount" json:"customerRateAmount,omitempty"`
	CarrierCostAmount        *float64 `gorm:"column:carrier_cost_amount" json:"carrierCostAmount,omitempty"`
	PlatformCommissionAmount *float64 `gorm:"column:platform_commission_amount" json:"platformCommissionAmount,omitempty"`
	MarginAmount             *float64 `gorm:"column:margin_amount" json:"marginAmount,omitempty"`

	AssignedCarrierID *string `gorm:"column:assigned_carrier_id" json:"assignedCarrierId,omitempty"`
	AssignedDriverID  *string `gorm:"column:assigned_driver_id" json:"assignedDriverId,omitempty"`
	AssignedVehicleID *string `gorm:"column:assigned_vehicle_id" json:"assignedVehicleId,omitempty"`

	SourceChannel *string        `gorm:"column:source_channel" json:"sourceChannel,omitempty"`
	Notes         *string        `gorm:"column:notes" json:"notes,omitempty"`
	Metadata      map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
	CreatedBy     *string        `gorm:"column:created_by" json:"createdBy,omitempty"`
	UpdatedBy     *string        `gorm:"column:updated_by" json:"updatedBy,omitempty"`
}

// TableName pins the table explicitly. GORM's default pluralizer would
// produce the same string here, but the logistics tables are owned by the
// Next.js migrations — pinning the name means a future GORM naming-strategy
// change can never silently repoint these structs at the wrong table.
func (LogisticsShipmentOrder) TableName() string { return "logistics_shipment_orders" }

// BeforeCreate fills the id (UUID, matching the table's gen_random_uuid()
// default) and a human-facing shipment_no when the caller didn't supply one.
//
// shipment_no format: SHP<YY><sequence>, e.g. SHP26001042. The sequence is
// the tenant's existing shipment count + a 1000 base, mirroring the
// MaintenanceRequest / ServiceRequest ID scheme in models.go. Like those,
// it carries the same benign race under high concurrency (two simultaneous
// creates can compute the same number); the Next.js side already tolerates
// that for shipment_no since it's a display ref, not the primary key.
func (s *LogisticsShipmentOrder) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	if s.ShipmentNo != "" {
		return nil
	}
	if s.TenantID == "" {
		// Defensive: never mint a ref for an unscoped row. The handler
		// stamps TenantID from the token before Create, so this only
		// trips on a programming error — fail loudly rather than write a
		// tenant-less shipment.
		return fmt.Errorf("logistics: cannot generate shipment_no without tenant_id")
	}
	var count int64
	if err := tx.Model(&LogisticsShipmentOrder{}).
		Where("tenant_id = ?", s.TenantID).
		Count(&count).Error; err != nil {
		return err
	}
	s.ShipmentNo = fmt.Sprintf("SHP%s%d", time.Now().Format("06"), 1000+count+1)
	return nil
}

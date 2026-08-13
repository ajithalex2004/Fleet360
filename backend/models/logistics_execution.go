package models

// Logistics execution models (Phase L2) — the trip layer: multi-stop routes,
// carrier/driver assignments, GPS tracking pings, telematics device feed, and
// proof-of-delivery.
//
// Soft-delete / timestamp shape (verified against domain.ts DDL):
//   - NONE of these six tables has a deleted_at column → none embeds Model
//     (embedding it would make GORM inject `WHERE deleted_at IS NULL` against a
//     missing column and break every query).
//   - logistics_shipment_stops, logistics_route_legs, logistics_assignments
//     have created_at AND updated_at → embed both.
//   - logistics_tracking_events, logistics_pod_events, logistics_telematics_events
//     have ONLY created_at (no updated_at) → embed id/created_at only. GORM
//     still autofills CreatedAt by field-name convention without Model.
//
// All ids are TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, but GORM would
// send an empty string and clobber that default, so every model sets the UUID
// in BeforeCreate.

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ── logistics_shipment_stops ─────────────────────────────────────────────────

// LogisticsShipmentStop maps `logistics_shipment_stops` — an ordered pickup or
// delivery (or intermediate) stop on a shipment's route. sequence_no orders
// them; the planned_* / actual_* pairs drive on-time and dwell-time metrics.
type LogisticsShipmentStop struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	SequenceNo int    `gorm:"column:sequence_no;not null" json:"sequenceNo"`
	StopType   string `gorm:"column:stop_type;not null" json:"stopType"`

	LocationName *string  `gorm:"column:location_name" json:"locationName,omitempty"`
	Address      *string  `gorm:"column:address" json:"address,omitempty"`
	ContactName  *string  `gorm:"column:contact_name" json:"contactName,omitempty"`
	ContactPhone *string  `gorm:"column:contact_phone" json:"contactPhone,omitempty"`
	Latitude     *float64 `gorm:"column:latitude" json:"latitude,omitempty"`
	Longitude    *float64 `gorm:"column:longitude" json:"longitude,omitempty"`

	// GeofenceRadiusM is added by the geofence-schema ALTER (geofence-schema.ts),
	// NOT the base CREATE TABLE — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS
	// geofence_radius_m INTEGER`. The geofence ingest reads it as the per-stop
	// arrival-zone radius (falling back to 200m when NULL). Nullable → pointer.
	GeofenceRadiusM *int `gorm:"column:geofence_radius_m" json:"geofenceRadiusM,omitempty"`

	PlannedArrivalAt *time.Time `gorm:"column:planned_arrival_at" json:"plannedArrivalAt,omitempty"`
	PlannedDepartAt  *time.Time `gorm:"column:planned_depart_at" json:"plannedDepartAt,omitempty"`
	ActualArrivalAt  *time.Time `gorm:"column:actual_arrival_at" json:"actualArrivalAt,omitempty"`
	ActualDepartAt   *time.Time `gorm:"column:actual_depart_at" json:"actualDepartAt,omitempty"`

	Status       string         `gorm:"column:status;not null;default:PLANNED" json:"status"`
	Instructions *string        `gorm:"column:instructions" json:"instructions,omitempty"`
	Metadata     map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsShipmentStop) TableName() string { return "logistics_shipment_stops" }

func (s *LogisticsShipmentStop) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_route_legs ─────────────────────────────────────────────────────

// LogisticsRouteLeg maps `logistics_route_legs` — a planned/actual segment
// between two stops, carrying distance, duration and toll estimates. The VRP
// planner (Phase L4) writes the planned_* values; execution fills actual_*.
type LogisticsRouteLeg struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	SequenceNo int     `gorm:"column:sequence_no;not null" json:"sequenceNo"`
	FromStopID *string `gorm:"column:from_stop_id" json:"fromStopId,omitempty"`
	ToStopID   *string `gorm:"column:to_stop_id" json:"toStopId,omitempty"`

	PlannedDistanceKm  *float64 `gorm:"column:planned_distance_km" json:"plannedDistanceKm,omitempty"`
	PlannedDurationMin *int     `gorm:"column:planned_duration_min" json:"plannedDurationMin,omitempty"`
	ActualDistanceKm   *float64 `gorm:"column:actual_distance_km" json:"actualDistanceKm,omitempty"`
	ActualDurationMin  *int     `gorm:"column:actual_duration_min" json:"actualDurationMin,omitempty"`
	TollAmount         *float64 `gorm:"column:toll_amount" json:"tollAmount,omitempty"`

	Status   string         `gorm:"column:status;not null;default:PLANNED" json:"status"`
	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsRouteLeg) TableName() string { return "logistics_route_legs" }

func (l *LogisticsRouteLeg) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_assignments ────────────────────────────────────────────────────

// LogisticsAssignment maps `logistics_assignments` — who is moving the
// shipment: an external carrier (assignment_type CARRIER) or an own
// driver+vehicle (assignment_type FLEET). Tracks the accept → dispatch →
// complete lifecycle and the agreed cost.
type LogisticsAssignment struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	CarrierID *string `gorm:"column:carrier_id" json:"carrierId,omitempty"`
	DriverID  *string `gorm:"column:driver_id" json:"driverId,omitempty"`
	VehicleID *string `gorm:"column:vehicle_id" json:"vehicleId,omitempty"`

	AssignmentType string   `gorm:"column:assignment_type;not null;default:CARRIER" json:"assignmentType"`
	Status         string   `gorm:"column:status;not null;default:ASSIGNED" json:"status"`
	CostAmount     *float64 `gorm:"column:cost_amount" json:"costAmount,omitempty"`
	Currency       string   `gorm:"column:currency;not null;default:AED" json:"currency"`

	AcceptedAt   *time.Time `gorm:"column:accepted_at" json:"acceptedAt,omitempty"`
	DispatchedAt *time.Time `gorm:"column:dispatched_at" json:"dispatchedAt,omitempty"`
	CompletedAt  *time.Time `gorm:"column:completed_at" json:"completedAt,omitempty"`

	// RoutePlanID / SequenceInRoute link an assignment back to the VRP plan that
	// produced it and its position on that vehicle's route. Both are added by the
	// route-optimizer ALTER (route-optimizer-schema.ts), NOT the base CREATE
	// TABLE, and are written only by the planner's commitPlan path. Nullable →
	// pointers (assignments created by the manual dispatch flow leave them NULL).
	RoutePlanID     *string `gorm:"column:route_plan_id" json:"routePlanId,omitempty"`
	SequenceInRoute *int    `gorm:"column:sequence_in_route" json:"sequenceInRoute,omitempty"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsAssignment) TableName() string { return "logistics_assignments" }

func (a *LogisticsAssignment) BeforeCreate(tx *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_tracking_events ────────────────────────────────────────────────

// LogisticsTrackingEvent maps `logistics_tracking_events` — the shipment
// timeline: status changes, GPS pings, geofence ENTER/EXIT, milestones. This
// table has created_at but NO updated_at (events are immutable once recorded).
// occurred_at is when the event happened (may differ from created_at).
type LogisticsTrackingEvent struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	AssignmentID    *string   `gorm:"column:assignment_id" json:"assignmentId,omitempty"`

	EventType string   `gorm:"column:event_type;not null" json:"eventType"`
	Status    *string  `gorm:"column:status" json:"status,omitempty"`
	Latitude  *float64 `gorm:"column:latitude" json:"latitude,omitempty"`
	Longitude *float64 `gorm:"column:longitude" json:"longitude,omitempty"`
	Source    string   `gorm:"column:source;not null;default:SYSTEM" json:"source"`

	OccurredAt time.Time      `gorm:"column:occurred_at;not null" json:"occurredAt"`
	Notes      *string        `gorm:"column:notes" json:"notes,omitempty"`
	Metadata   map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsTrackingEvent) TableName() string { return "logistics_tracking_events" }

// BeforeCreate stamps the UUID and defaults occurred_at to now (mirroring the
// column's DEFAULT NOW()) — GORM would otherwise insert the zero time and the
// DB default never fires.
func (e *LogisticsTrackingEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	if e.OccurredAt.IsZero() {
		e.OccurredAt = time.Now()
	}
	return nil
}

// ── logistics_pod_events ─────────────────────────────────────────────────────

// LogisticsPodEvent maps `logistics_pod_events` — proof of delivery: recipient,
// signature, photos, scanned documents, and capture GPS. created_at only (no
// updated_at). photo_urls / document_urls are JSONB string arrays; gps is a
// JSONB object.
type LogisticsPodEvent struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	AssignmentID    *string   `gorm:"column:assignment_id" json:"assignmentId,omitempty"`

	DeliveredAt   *time.Time `gorm:"column:delivered_at" json:"deliveredAt,omitempty"`
	RecipientName *string    `gorm:"column:recipient_name" json:"recipientName,omitempty"`
	SignatureURL  *string    `gorm:"column:signature_url" json:"signatureUrl,omitempty"`

	PhotoURLs    []string       `gorm:"column:photo_urls;serializer:json" json:"photoUrls,omitempty"`
	DocumentURLs []string       `gorm:"column:document_urls;serializer:json" json:"documentUrls,omitempty"`
	GPS          map[string]any `gorm:"column:gps;serializer:json" json:"gps,omitempty"`

	Status    string         `gorm:"column:status;not null;default:SUBMITTED" json:"status"`
	CreatedBy *string        `gorm:"column:created_by" json:"createdBy,omitempty"`
	Metadata  map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsPodEvent) TableName() string { return "logistics_pod_events" }

func (p *LogisticsPodEvent) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_telematics_events ──────────────────────────────────────────────

// LogisticsTelematicsEvent maps `logistics_telematics_events` — the raw device
// feed from a telematics provider (position, speed, heading, odometer) plus the
// provider-supplied ETA. created_at only. event_time is when the device
// reported; raw_payload keeps the untransformed vendor JSON for audit.
type LogisticsTelematicsEvent struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	AssignmentID    *string   `gorm:"column:assignment_id" json:"assignmentId,omitempty"`
	VehicleID       *string   `gorm:"column:vehicle_id" json:"vehicleId,omitempty"`

	Provider   *string  `gorm:"column:provider" json:"provider,omitempty"`
	DeviceID   *string  `gorm:"column:device_id" json:"deviceId,omitempty"`
	Latitude   *float64 `gorm:"column:latitude" json:"latitude,omitempty"`
	Longitude  *float64 `gorm:"column:longitude" json:"longitude,omitempty"`
	SpeedKph   *float64 `gorm:"column:speed_kph" json:"speedKph,omitempty"`
	Heading    *float64 `gorm:"column:heading" json:"heading,omitempty"`
	OdometerKm *float64 `gorm:"column:odometer_km" json:"odometerKm,omitempty"`

	EventTime     time.Time      `gorm:"column:event_time;not null" json:"eventTime"`
	EtaAt         *time.Time     `gorm:"column:eta_at" json:"etaAt,omitempty"`
	EtaConfidence *float64       `gorm:"column:eta_confidence" json:"etaConfidence,omitempty"`
	RawPayload    map[string]any `gorm:"column:raw_payload;serializer:json" json:"rawPayload,omitempty"`
}

func (LogisticsTelematicsEvent) TableName() string { return "logistics_telematics_events" }

// BeforeCreate stamps the UUID and defaults event_time to now (mirroring the
// column's DEFAULT NOW()).
func (e *LogisticsTelematicsEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	if e.EventTime.IsZero() {
		e.EventTime = time.Now()
	}
	return nil
}

// ── logistics_shipment_exceptions ────────────────────────────────────────────

// LogisticsShipmentException maps `logistics_shipment_exceptions` — an
// actionable problem raised against a shipment (geofence route deviation,
// arrival/departure milestone, SLA breach, …) that ops triages through an
// acknowledge → escalate → resolve lifecycle. The geofence ingest path
// (geofence-service.ts) raises a row here on each transition, de-duped against
// OPEN rows of the same exception_type in a short window.
//
// Timestamp shape: created_at AND updated_at, NO deleted_at → embed both
// directly (not Model). raised_at is NOT NULL DEFAULT NOW(); BeforeCreate
// defaults it so a GORM insert that omits it doesn't write the zero time.
type LogisticsShipmentException struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	AssignmentID    *string   `gorm:"column:assignment_id" json:"assignmentId,omitempty"`

	ExceptionType string  `gorm:"column:exception_type;not null" json:"exceptionType"`
	Severity      string  `gorm:"column:severity;not null;default:MEDIUM" json:"severity"`
	Status        string  `gorm:"column:status;not null;default:OPEN" json:"status"`
	Title         string  `gorm:"column:title;not null" json:"title"`
	Description   *string `gorm:"column:description" json:"description,omitempty"`

	RaisedAt       time.Time  `gorm:"column:raised_at;not null" json:"raisedAt"`
	AssignedTo     *string    `gorm:"column:assigned_to" json:"assignedTo,omitempty"`
	AcknowledgedAt *time.Time `gorm:"column:acknowledged_at" json:"acknowledgedAt,omitempty"`
	AcknowledgedBy *string    `gorm:"column:acknowledged_by" json:"acknowledgedBy,omitempty"`
	EscalatedAt    *time.Time `gorm:"column:escalated_at" json:"escalatedAt,omitempty"`
	EscalatedBy    *string    `gorm:"column:escalated_by" json:"escalatedBy,omitempty"`
	SlaDueAt       *time.Time `gorm:"column:sla_due_at" json:"slaDueAt,omitempty"`
	SlaBreachedAt  *time.Time `gorm:"column:sla_breached_at" json:"slaBreachedAt,omitempty"`
	ResolvedAt     *time.Time `gorm:"column:resolved_at" json:"resolvedAt,omitempty"`
	ResolutionNote *string    `gorm:"column:resolution_note" json:"resolutionNote,omitempty"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsShipmentException) TableName() string { return "logistics_shipment_exceptions" }

func (e *LogisticsShipmentException) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		e.ID = uuid.New().String()
	}
	if e.RaisedAt.IsZero() {
		e.RaisedAt = time.Now()
	}
	return nil
}

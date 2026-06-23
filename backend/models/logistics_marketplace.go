package models

// Logistics marketplace models (Phase L1) — carriers, rate contracts, the
// RFQ/bid spot-market loop, and carrier scorecards. Same mapping rules as
// logistics.go: embed Model, nullable cols -> pointers, JSONB ->
// map[string]any with serializer:json, explicit TableName().

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LogisticsCarrier maps `logistics_carriers` — a transport company or
// owner-operator the tenant can tender freight to. Onboarding, compliance
// and commission terms live here; the carrier's fleet is in
// logistics_carrier_vehicles and its docs in logistics_carrier_documents.
type LogisticsCarrier struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	CarrierCode  *string `gorm:"column:carrier_code" json:"carrierCode,omitempty"`
	CarrierType  string  `gorm:"column:carrier_type;not null;default:TRANSPORT_COMPANY" json:"carrierType"`
	Name         string  `gorm:"column:name;not null" json:"name"`
	TradeLicense *string `gorm:"column:trade_license" json:"tradeLicense,omitempty"`

	ContactName  *string `gorm:"column:contact_name" json:"contactName,omitempty"`
	ContactEmail *string `gorm:"column:contact_email" json:"contactEmail,omitempty"`
	ContactPhone *string `gorm:"column:contact_phone" json:"contactPhone,omitempty"`

	Status           string `gorm:"column:status;not null;default:ACTIVE" json:"status"`
	OnboardingStatus string `gorm:"column:onboarding_status;not null;default:DRAFT" json:"onboardingStatus"`
	ComplianceStatus string `gorm:"column:compliance_status;not null;default:PENDING" json:"complianceStatus"`

	ServiceRegions  map[string]any `gorm:"column:service_regions;serializer:json" json:"serviceRegions,omitempty"`
	CapacityProfile map[string]any `gorm:"column:capacity_profile;serializer:json" json:"capacityProfile,omitempty"`
	CommissionModel *string        `gorm:"column:commission_model" json:"commissionModel,omitempty"`
	CommissionRate  *float64       `gorm:"column:commission_rate" json:"commissionRate,omitempty"`
	MarginRuleJSON  map[string]any `gorm:"column:margin_rule_json;serializer:json" json:"marginRuleJson,omitempty"`
	Metadata        map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsCarrier) TableName() string { return "logistics_carriers" }

// LogisticsRateContract maps `logistics_rate_contracts` — a negotiated lane
// price (customer- and/or carrier-scoped) the rate engine scores against.
// The Go rate engine (logistics/rateengine) consumes these rows; see that
// package for scoring + effective-date gating + price computation.
type LogisticsRateContract struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	CustomerID   *string `gorm:"column:customer_id" json:"customerId,omitempty"`
	CustomerName *string `gorm:"column:customer_name" json:"customerName,omitempty"`
	CarrierID    *string `gorm:"column:carrier_id" json:"carrierId,omitempty"`

	ContractNo      string  `gorm:"column:contract_no;not null" json:"contractNo"`
	LaneOrigin      string  `gorm:"column:lane_origin;not null" json:"laneOrigin"`
	LaneDestination string  `gorm:"column:lane_destination;not null" json:"laneDestination"`
	VehicleType     *string `gorm:"column:vehicle_type" json:"vehicleType,omitempty"`
	ServiceLevel    *string `gorm:"column:service_level" json:"serviceLevel,omitempty"`

	Currency         string         `gorm:"column:currency;not null;default:AED" json:"currency"`
	BaseRate         float64        `gorm:"column:base_rate;not null;default:0" json:"baseRate"`
	MinCharge        *float64       `gorm:"column:min_charge" json:"minCharge,omitempty"`
	FuelSurchargePct *float64       `gorm:"column:fuel_surcharge_pct" json:"fuelSurchargePct,omitempty"`
	AccessorialRules map[string]any `gorm:"column:accessorial_rules;serializer:json" json:"accessorialRules,omitempty"`

	// effective_from / effective_to are SQL DATE columns. time.Time scans a
	// DATE fine; the engine compares on the date portion only.
	EffectiveFrom *time.Time     `gorm:"column:effective_from" json:"effectiveFrom,omitempty"`
	EffectiveTo   *time.Time     `gorm:"column:effective_to" json:"effectiveTo,omitempty"`
	Status        string         `gorm:"column:status;not null;default:ACTIVE" json:"status"`
	Metadata      map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsRateContract) TableName() string { return "logistics_rate_contracts" }

// BeforeCreate stamps a UUID and a human-readable contract_no when the caller
// didn't supply them. Defining this on the outer struct shadows the embedded
// Model.BeforeCreate, so we replicate its UUID assignment here. contract_no
// mirrors the Next.js nextRateContractNo() — RC-LOG-<YY><6 hex>, random rather
// than a sequence so concurrent inserts don't collide on a count() race (the
// table has a UNIQUE (tenant_id, contract_no) index).
func (rc *LogisticsRateContract) BeforeCreate(tx *gorm.DB) error {
	if rc.ID == "" {
		rc.ID = uuid.New().String()
	}
	if strings.TrimSpace(rc.ContractNo) != "" {
		return nil
	}
	var b [3]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Errorf("logistics: contract_no entropy: %w", err)
	}
	rc.ContractNo = fmt.Sprintf("RC-LOG-%s%s", time.Now().Format("06"), strings.ToUpper(hex.EncodeToString(b[:])))
	return nil
}

// LogisticsFreightRFQ maps `logistics_freight_rfqs` — a request for quotes
// posted against a shipment order, inviting carrier bids.
type LogisticsFreightRFQ struct {
	// logistics_freight_rfqs has NO deleted_at column, so it embeds the
	// timestamp-only fields directly rather than the soft-delete-bearing Model.
	// Embedding Model here would make GORM inject `WHERE deleted_at IS NULL`
	// against a column that doesn't exist and fail every query.
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	RFQNo            string         `gorm:"column:rfq_no;not null" json:"rfqNo"`
	Status           string         `gorm:"column:status;not null;default:DRAFT" json:"status"`
	InviteScope      string         `gorm:"column:invite_scope;not null;default:SELECTED_CARRIERS" json:"inviteScope"`
	BidDeadlineAt    *time.Time     `gorm:"column:bid_deadline_at" json:"bidDeadlineAt,omitempty"`
	NegotiationRound int            `gorm:"column:negotiation_round;not null;default:1" json:"negotiationRound"`
	AwardedBidID     *string        `gorm:"column:awarded_bid_id" json:"awardedBidId,omitempty"`
	Metadata         map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsFreightRFQ) TableName() string { return "logistics_freight_rfqs" }

// BeforeCreate stamps the UUID (no embedded Model to do it) and a sequential
// rfq_no (RFQ-LOG-<YY><5-digit per-tenant counter>), mirroring the Next.js
// nextDocNumber generator. The count is per-tenant per-prefix.
func (r *LogisticsFreightRFQ) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	if strings.TrimSpace(r.RFQNo) != "" {
		return nil
	}
	if r.TenantID == "" {
		return fmt.Errorf("logistics: cannot generate rfq_no without tenant_id")
	}
	prefix := fmt.Sprintf("RFQ-LOG-%s", time.Now().Format("06"))
	var count int64
	if err := tx.Model(&LogisticsFreightRFQ{}).
		Where("tenant_id = ? AND rfq_no LIKE ?", r.TenantID, prefix+"%").
		Count(&count).Error; err != nil {
		return err
	}
	r.RFQNo = fmt.Sprintf("%s%05d", prefix, count+1)
	return nil
}

// LogisticsCarrierBid maps `logistics_carrier_bids` — a carrier's price
// offer on a shipment (optionally tied to an RFQ).
type LogisticsCarrierBid struct {
	// This table has no deleted_at column, so it embeds the timestamp-only
	// fields directly rather than the soft-delete-bearing Model.
	ID               string         `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt        time.Time      `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt        time.Time      `gorm:"column:updated_at" json:"updatedAt"`
	TenantID         string         `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID  string         `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	RFQID            *string        `gorm:"column:rfq_id" json:"rfqId,omitempty"`
	CarrierID        string         `gorm:"column:carrier_id;not null" json:"carrierId"`
	BidNo            *string        `gorm:"column:bid_no" json:"bidNo,omitempty"`
	Amount           float64        `gorm:"column:amount;not null" json:"amount"`
	Currency         string         `gorm:"column:currency;not null;default:AED" json:"currency"`
	TransitTimeHours *int           `gorm:"column:transit_time_hours" json:"transitTimeHours,omitempty"`
	ValidityUntil    *time.Time     `gorm:"column:validity_until" json:"validityUntil,omitempty"`
	Status           string         `gorm:"column:status;not null;default:SUBMITTED" json:"status"`
	ChargeBreakdown  map[string]any `gorm:"column:charge_breakdown;serializer:json" json:"chargeBreakdown,omitempty"`
	Notes            *string        `gorm:"column:notes" json:"notes,omitempty"`
}

func (LogisticsCarrierBid) TableName() string { return "logistics_carrier_bids" }

// BeforeCreate stamps the UUID and a sequential bid_no (BID-LOG-<YY><5-digit
// per-tenant counter>) when omitted. bid_no is nullable in the schema, but the
// Next.js path always assigns one on submission, so we do too for parity.
func (b *LogisticsCarrierBid) BeforeCreate(tx *gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	if b.BidNo != nil && strings.TrimSpace(*b.BidNo) != "" {
		return nil
	}
	if b.TenantID == "" {
		return fmt.Errorf("logistics: cannot generate bid_no without tenant_id")
	}
	prefix := fmt.Sprintf("BID-LOG-%s", time.Now().Format("06"))
	var count int64
	if err := tx.Model(&LogisticsCarrierBid{}).
		Where("tenant_id = ? AND bid_no LIKE ?", b.TenantID, prefix+"%").
		Count(&count).Error; err != nil {
		return err
	}
	no := fmt.Sprintf("%s%05d", prefix, count+1)
	b.BidNo = &no
	return nil
}

// LogisticsCarrierScorecard maps `logistics_carrier_scorecards` — periodic
// performance metrics used to rank carriers and drive preferred/blacklist
// flags.
type LogisticsCarrierScorecard struct {
	// No deleted_at column on this table either.
	ID        string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID  string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	CarrierID string    `gorm:"column:carrier_id;not null;index" json:"carrierId"`

	PeriodStart        *time.Time     `gorm:"column:period_start" json:"periodStart,omitempty"`
	PeriodEnd          *time.Time     `gorm:"column:period_end" json:"periodEnd,omitempty"`
	OnTimeRate         *float64       `gorm:"column:on_time_rate" json:"onTimeRate,omitempty"`
	AcceptanceRate     *float64       `gorm:"column:acceptance_rate" json:"acceptanceRate,omitempty"`
	CancellationRate   *float64       `gorm:"column:cancellation_rate" json:"cancellationRate,omitempty"`
	ClaimRate          *float64       `gorm:"column:claim_rate" json:"claimRate,omitempty"`
	ComplianceScore    *float64       `gorm:"column:compliance_score" json:"complianceScore,omitempty"`
	AverageRating      *float64       `gorm:"column:average_rating" json:"averageRating,omitempty"`
	ShipmentsCompleted int            `gorm:"column:shipments_completed;not null;default:0" json:"shipmentsCompleted"`
	Preferred          bool           `gorm:"column:preferred;not null;default:false" json:"preferred"`
	Blacklisted        bool           `gorm:"column:blacklisted;not null;default:false" json:"blacklisted"`
	BlacklistReason    *string        `gorm:"column:blacklist_reason" json:"blacklistReason,omitempty"`
	Status             string         `gorm:"column:status;not null;default:ACTIVE" json:"status"`
	Metadata           map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsCarrierScorecard) TableName() string { return "logistics_carrier_scorecards" }

// BeforeCreate stamps the UUID (no embedded Model to do it).
func (s *LogisticsCarrierScorecard) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

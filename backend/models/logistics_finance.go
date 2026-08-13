package models

// Logistics finance models (Phase L3) — the money layer that hangs off a
// shipment: per-side freight charges, carrier settlements, driver payouts, and
// the postings that tie each of those into the shared core-finance ledger
// (finance_invoices / finance_journal_entries).
//
// Timestamp shape (verified against domain.ts DDL, lines 1139-1214): all four
// tables have created_at AND updated_at but NO deleted_at → embed both directly
// (never Model — that would inject `WHERE deleted_at IS NULL` against a missing
// column). ids are TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text; GORM would
// send an empty string and clobber that default, so each model stamps its UUID
// in BeforeCreate.
//
// All money columns are NUMERIC(15,2) NOT NULL DEFAULT 0 → float64 (never a
// pointer; the column always holds a value). Nullable TEXT/DATE columns → Go
// pointers. metadata JSONB → map[string]any with serializer:json.

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ── logistics_freight_charges ────────────────────────────────────────────────

// LogisticsFreightCharge maps `logistics_freight_charges` — a single billable
// line on a shipment. charge_side is CUSTOMER (revenue, billed to the cargo
// owner) or CARRIER (cost, payable to the hauler); charge_type distinguishes the
// base freight (CUSTOMER_FREIGHT / CARRIER_FREIGHT) from accessorials. The
// 3-way reconciliation sums total_amount by side and compares it to what was
// posted into the ledger. billing_status walks DRAFT → READY → POSTED.
type LogisticsFreightCharge struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	ChargeSide  string  `gorm:"column:charge_side;not null" json:"chargeSide"`
	ChargeType  string  `gorm:"column:charge_type;not null" json:"chargeType"`
	Description *string `gorm:"column:description" json:"description,omitempty"`

	// quantity DEFAULT 1 (the others DEFAULT 0). default:1 lets a zero-value
	// create fall through to the column default rather than writing 0.
	Quantity    float64 `gorm:"column:quantity;not null;default:1" json:"quantity"`
	UnitRate    float64 `gorm:"column:unit_rate;not null;default:0" json:"unitRate"`
	Amount      float64 `gorm:"column:amount;not null;default:0" json:"amount"`
	TaxAmount   float64 `gorm:"column:tax_amount;not null;default:0" json:"taxAmount"`
	TotalAmount float64 `gorm:"column:total_amount;not null;default:0" json:"totalAmount"`

	Currency      string  `gorm:"column:currency;not null;default:AED" json:"currency"`
	BillingStatus string  `gorm:"column:billing_status;not null;default:DRAFT" json:"billingStatus"`
	InvoiceID     *string `gorm:"column:invoice_id" json:"invoiceId,omitempty"`
	SettlementID  *string `gorm:"column:settlement_id" json:"settlementId,omitempty"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsFreightCharge) TableName() string { return "logistics_freight_charges" }

func (c *LogisticsFreightCharge) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_carrier_settlements ────────────────────────────────────────────

// LogisticsCarrierSettlement maps `logistics_carrier_settlements` — a periodic
// statement rolling up what a carrier is owed: gross freight minus deductions
// and platform commission yields net_payable_amount. settlement_no is the
// human-facing reference (SET-LOG-YY-#####). status walks DRAFT → READY →
// POSTED → REVERSED.
type LogisticsCarrierSettlement struct {
	ID        string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID  string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	CarrierID    string `gorm:"column:carrier_id;not null;index" json:"carrierId"`
	SettlementNo string `gorm:"column:settlement_no;not null" json:"settlementNo"`

	PeriodStart *time.Time `gorm:"column:period_start" json:"periodStart,omitempty"`
	PeriodEnd   *time.Time `gorm:"column:period_end" json:"periodEnd,omitempty"`

	GrossAmount      float64 `gorm:"column:gross_amount;not null;default:0" json:"grossAmount"`
	DeductionsAmount float64 `gorm:"column:deductions_amount;not null;default:0" json:"deductionsAmount"`
	CommissionAmount float64 `gorm:"column:commission_amount;not null;default:0" json:"commissionAmount"`
	NetPayableAmount float64 `gorm:"column:net_payable_amount;not null;default:0" json:"netPayableAmount"`

	Currency  string  `gorm:"column:currency;not null;default:AED" json:"currency"`
	Status    string  `gorm:"column:status;not null;default:DRAFT" json:"status"`
	PaymentID *string `gorm:"column:payment_id" json:"paymentId,omitempty"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsCarrierSettlement) TableName() string { return "logistics_carrier_settlements" }

func (s *LogisticsCarrierSettlement) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_driver_payouts ─────────────────────────────────────────────────

// LogisticsDriverPayout maps `logistics_driver_payouts` — what an own/contract
// driver earns for moving a shipment (gross is a share of the carrier amount;
// net_payable_amount is after deductions). payout_no is DPO-LOG-YY-#####. Tied
// to a shipment and optionally the specific assignment + driver.
type LogisticsDriverPayout struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	AssignmentID *string `gorm:"column:assignment_id" json:"assignmentId,omitempty"`
	DriverID     *string `gorm:"column:driver_id" json:"driverId,omitempty"`
	PayoutNo     string  `gorm:"column:payout_no;not null" json:"payoutNo"`

	GrossAmount      float64 `gorm:"column:gross_amount;not null;default:0" json:"grossAmount"`
	DeductionsAmount float64 `gorm:"column:deductions_amount;not null;default:0" json:"deductionsAmount"`
	NetPayableAmount float64 `gorm:"column:net_payable_amount;not null;default:0" json:"netPayableAmount"`

	Currency  string  `gorm:"column:currency;not null;default:AED" json:"currency"`
	Status    string  `gorm:"column:status;not null;default:DRAFT" json:"status"`
	PaymentID *string `gorm:"column:payment_id" json:"paymentId,omitempty"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsDriverPayout) TableName() string { return "logistics_driver_payouts" }

func (p *LogisticsDriverPayout) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// ── logistics_finance_postings ───────────────────────────────────────────────

// LogisticsFinancePosting maps `logistics_finance_postings` — the bridge row
// linking a logistics money event to the shared core-finance ledger. posting_type
// is CUSTOMER_INVOICE / CARRIER_PAYABLE / CARRIER_SETTLEMENT / DRIVER_PAYOUT;
// finance_invoice_id and finance_journal_entry_id point at the rows created in
// the core ledger. status POSTED → REVERSED. There is a UNIQUE constraint on
// (tenant_id, shipment_order_id, posting_type, source_record_id) so a re-post is
// an idempotent UPSERT rather than a duplicate.
type LogisticsFinancePosting struct {
	ID              string    `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt       time.Time `gorm:"column:created_at" json:"createdAt"`
	UpdatedAt       time.Time `gorm:"column:updated_at" json:"updatedAt"`
	TenantID        string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID string    `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`

	PostingType           string  `gorm:"column:posting_type;not null" json:"postingType"`
	SourceRecordID        string  `gorm:"column:source_record_id;not null;default:''" json:"sourceRecordId"`
	FinanceInvoiceID      *string `gorm:"column:finance_invoice_id" json:"financeInvoiceId,omitempty"`
	FinanceJournalEntryID *string `gorm:"column:finance_journal_entry_id" json:"financeJournalEntryId,omitempty"`

	Amount   float64 `gorm:"column:amount;not null;default:0" json:"amount"`
	Currency string  `gorm:"column:currency;not null;default:AED" json:"currency"`
	Status   string  `gorm:"column:status;not null;default:POSTED" json:"status"`

	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsFinancePosting) TableName() string { return "logistics_finance_postings" }

func (p *LogisticsFinancePosting) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

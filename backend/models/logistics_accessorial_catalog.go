package models

// LogisticsAccessorialCatalog maps `logistics_accessorial_catalog` — the
// tenant's library of accessorial charges (fuel surcharge, customs, waiting
// time, multi-drop, weight handling, …) plus the optional auto_apply_rule that
// the accessorial engine evaluates at shipment-create time.
//
// Schema source: src/lib/logistics/domain.ts (CREATE TABLE IF NOT EXISTS,
// lines ~1312-1329). The table HAS deleted_at, so unlike the finance tables
// this model embeds Model — GORM's soft-delete scope (`WHERE deleted_at IS
// NULL`) then matches the partial unique index the DDL builds on
// (tenant_id, code) WHERE deleted_at IS NULL.
//
// Read-only from Go for now: catalog CRUD stays in the Next.js admin UI until
// the L4d cutover. The Go side only loads ACTIVE rows to drive create-time
// auto-apply (handlers/logistics_accessorial.go), so the Model.BeforeCreate
// UUID hook never fires on this path — but it's correct if writes move here.
type LogisticsAccessorialCatalog struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	Code string `gorm:"column:code;not null" json:"code"`
	Name string `gorm:"column:name;not null" json:"name"`
	// charge_type is NOT NULL DEFAULT 'ACCESSORIAL' → plain string.
	ChargeType string `gorm:"column:charge_type;not null;default:ACCESSORIAL" json:"chargeType"`
	// default_amount is nullable NUMERIC(15,2) → pointer.
	DefaultAmount *float64 `gorm:"column:default_amount" json:"defaultAmount,omitempty"`
	Currency      string   `gorm:"column:currency;not null;default:AED" json:"currency"`
	Taxable       bool     `gorm:"column:taxable;not null;default:true" json:"taxable"`

	// auto_apply_rule is the JSONB blob the accessorial engine parses. NULL →
	// nil map (no auto-apply rule for this entry; manual-add only).
	AutoApplyRule map[string]any `gorm:"column:auto_apply_rule;serializer:json" json:"autoApplyRule,omitempty"`

	Status   string         `gorm:"column:status;not null;default:ACTIVE" json:"status"`
	Metadata map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

// TableName pins the table — the logistics_* tables are owned by the Next.js
// migrations, so the name is fixed here rather than left to GORM's pluralizer.
func (LogisticsAccessorialCatalog) TableName() string { return "logistics_accessorial_catalog" }

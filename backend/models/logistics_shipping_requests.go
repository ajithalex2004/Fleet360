package models

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LogisticsShippingRequest maps `logistics_shipping_requests` — the demand-intake
// table backing the shipping-requests inbox and conversion into shipment orders.
type LogisticsShippingRequest struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	RequestNo string `gorm:"column:request_no;not null" json:"requestNo"`
	ShipperID string `gorm:"column:shipper_id;not null" json:"shipperId"`

	Status       string  `gorm:"column:status;not null;default:SUBMITTED" json:"status"`
	ShipmentType *string `gorm:"column:shipment_type" json:"shipmentType,omitempty"`

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

	Currency            string         `gorm:"column:currency;not null;default:AED" json:"currency"`
	GoodsDescription    *string        `gorm:"column:goods_description" json:"goodsDescription,omitempty"`
	SpecialInstructions *string        `gorm:"column:special_instructions" json:"specialInstructions,omitempty"`
	ReferenceNo         *string        `gorm:"column:reference_no" json:"referenceNo,omitempty"`
	Source              string         `gorm:"column:source;not null;default:OPERATOR" json:"source"`
	ShipmentOrderID     *string        `gorm:"column:shipment_order_id" json:"shipmentOrderId,omitempty"`
	ReviewNotes         *string        `gorm:"column:review_notes" json:"reviewNotes,omitempty"`
	Metadata            map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
	CreatedBy           *string        `gorm:"column:created_by" json:"createdBy,omitempty"`
	UpdatedBy           *string        `gorm:"column:updated_by" json:"updatedBy,omitempty"`

	// Joined fields from customers table (read-only, populated on demand)
	ShipperName *string `gorm:"->;column:shipper_name" json:"shipperName,omitempty"`
	ShipperCode *string `gorm:"->;column:shipper_code" json:"shipperCode,omitempty"`
}

func (LogisticsShippingRequest) TableName() string { return "logistics_shipping_requests" }

// BeforeCreate fills the ID and request_no when omitted.
func (r *LogisticsShippingRequest) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	if r.RequestNo != "" {
		return nil
	}
	if r.TenantID == "" {
		return fmt.Errorf("logistics: cannot generate request_no without tenant_id")
	}

	reqNo, err := NextShippingRequestNo(tx, r.TenantID)
	if err != nil {
		return err
	}
	r.RequestNo = reqNo
	return nil
}

// NextShippingRequestNo generates the next atomic request_no (e.g. SR-2600001)
// using logistics_document_sequences matching the Next.js sequence generator.
func NextShippingRequestNo(tx *gorm.DB, tenantID string) (string, error) {
	yy := time.Now().Format("06")
	prefix := fmt.Sprintf("SR-%s", yy)

	var seq int
	seqQuery := `INSERT INTO logistics_document_sequences (tenant_id, doc_type, year_key, current_val, updated_at)
		VALUES (
			?, 'SHIPPING_REQUEST', ?,
			COALESCE(
				(SELECT MAX(NULLIF(regexp_replace(request_no, '^' || ?, ''), '')::integer)
				   FROM logistics_shipping_requests
				  WHERE tenant_id = ? AND request_no LIKE ?),
				0
			) + 1,
			NOW()
		)
		ON CONFLICT (tenant_id, doc_type, year_key)
		DO UPDATE SET current_val = logistics_document_sequences.current_val + 1, updated_at = NOW()
		RETURNING current_val`

	if err := tx.Raw(seqQuery, tenantID, yy, prefix, tenantID, prefix+"%").Scan(&seq).Error; err != nil {
		var count int64
		if countErr := tx.Model(&LogisticsShippingRequest{}).Where("tenant_id = ?", tenantID).Count(&count).Error; countErr != nil {
			return "", err
		}
		seq = int(count) + 1
	}

	return fmt.Sprintf("%s%05d", prefix, seq), nil
}

// NextShipmentOrderNo generates the next atomic shipment_no (e.g. SHP-LOG-2600001)
// using logistics_document_sequences matching the Next.js sequence generator.
func NextShipmentOrderNo(tx *gorm.DB, tenantID string) (string, error) {
	yy := time.Now().Format("06")
	prefix := fmt.Sprintf("SHP-LOG-%s", yy)

	var seq int
	seqQuery := `INSERT INTO logistics_document_sequences (tenant_id, doc_type, year_key, current_val, updated_at)
		VALUES (
			?, 'SHIPMENT', ?,
			COALESCE(
				(SELECT MAX(NULLIF(regexp_replace(shipment_no, '^' || ?, ''), '')::integer)
				   FROM logistics_shipment_orders
				  WHERE tenant_id = ? AND shipment_no LIKE ?),
				0
			) + 1,
			NOW()
		)
		ON CONFLICT (tenant_id, doc_type, year_key)
		DO UPDATE SET current_val = logistics_document_sequences.current_val + 1, updated_at = NOW()
		RETURNING current_val`

	if err := tx.Raw(seqQuery, tenantID, yy, prefix, tenantID, prefix+"%").Scan(&seq).Error; err != nil {
		var count int64
		if countErr := tx.Model(&LogisticsShipmentOrder{}).Where("tenant_id = ?", tenantID).Count(&count).Error; countErr != nil {
			return "", err
		}
		seq = int(count) + 1
	}

	return fmt.Sprintf("%s%05d", prefix, seq), nil
}

// LogisticsCargoLine maps `logistics_cargo_lines` — cargo line item on a shipment.
type LogisticsCargoLine struct {
	ID               string         `gorm:"primaryKey;column:id" json:"id"`
	CreatedAt        time.Time      `gorm:"column:created_at" json:"createdAt"`
	TenantID         string         `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ShipmentOrderID  string         `gorm:"column:shipment_order_id;not null;index" json:"shipmentOrderId"`
	ConsignmentID    *string        `gorm:"column:consignment_id" json:"consignmentId,omitempty"`
	Description      string         `gorm:"column:description;not null" json:"description"`
	CommodityCode    *string        `gorm:"column:commodity_code" json:"commodityCode,omitempty"`
	Quantity         *float64       `gorm:"column:quantity" json:"quantity,omitempty"`
	PackageType      *string        `gorm:"column:package_type" json:"packageType,omitempty"`
	WeightKg         *float64       `gorm:"column:weight_kg" json:"weightKg,omitempty"`
	VolumeCbm        *float64       `gorm:"column:volume_cbm" json:"volumeCbm,omitempty"`
	IsHazmat         bool           `gorm:"column:is_hazmat;not null;default:false" json:"isHazmat"`
	TempMinC         *float64       `gorm:"column:temp_min_c" json:"tempMinC,omitempty"`
	TempMaxC         *float64       `gorm:"column:temp_max_c" json:"tempMaxC,omitempty"`
	CargoValueAmount *float64       `gorm:"column:cargo_value_amount" json:"cargoValueAmount,omitempty"`
	Metadata         map[string]any `gorm:"column:metadata;serializer:json" json:"metadata,omitempty"`
}

func (LogisticsCargoLine) TableName() string { return "logistics_cargo_lines" }

func (l *LogisticsCargoLine) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.New().String()
	}
	return nil
}

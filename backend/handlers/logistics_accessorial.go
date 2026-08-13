package handlers

// Create-time accessorial auto-apply (the Go port of the Day-2 wiring in
// src/lib/logistics/accessorial-engine.ts + its shipper-portal call site).
//
// When a shipment is created, the tenant's ACTIVE accessorial catalog is
// evaluated against the new order. Each rule that fires writes a
// logistics_freight_charges row (charge_side=CUSTOMER, billing_status=READY)
// tagged metadata.autoApplied=true with the human-readable reason — closing
// the "operator forgot to add fuel/customs/multi-drop and we lost 5-15% of the
// invoice" leak the engine was built for.
//
// Best-effort by design: the shipment is already persisted before this runs,
// so a catalog query error or a single bad row never fails the booking. The
// pure evaluation lives in package accessorial; this file owns only the
// tenant-scoped catalog load and the freight-charge / tracking-event writes.

import (
	"log"
	"math"
	"strings"

	"fleet360-backend/accessorial"
	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
)

// accessorialVATRate is the UAE-standard 5% VAT, applied to taxable charges.
// Mirrors DEFAULT_VAT_RATE in the TS engine; switched off per-charge when the
// resolved taxable flag is false.
const accessorialVATRate = 0.05

// accessorialCatalogLimit caps the catalog load, matching the TS limit:500.
const accessorialCatalogLimit = 500

// applyAutoAccessorials evaluates the tenant's catalog against a freshly-created
// shipment and writes a READY freight_charges row for each rule that fires.
// Non-fatal: every failure path logs and returns without disturbing the create
// response. A no-op when the tenant has no ACTIVE catalog rows.
func applyAutoAccessorials(c *gin.Context, order *models.LogisticsShipmentOrder) {
	catalog := loadAccessorialCatalog(c)
	if len(catalog) == 0 {
		return
	}

	actorUID := ""
	if order.CreatedBy != nil {
		actorUID = *order.CreatedBy
	}

	ctx := buildShipmentAccessorialContext(order)
	applied := accessorial.ApplyAccessorialCatalog(catalog, ctx)

	for _, a := range applied {
		if err := writeAutoAccessorialCharge(order, actorUID, a); err != nil {
			// One bad row shouldn't sink the booking or the other charges.
			log.Printf("[logistics] auto-accessorial %s write failed for shipment %s: %v", a.Code, order.ID, err)
			continue
		}
	}
}

// loadAccessorialCatalog returns the tenant's ACTIVE catalog as pure-package
// CatalogEntry values. Soft-deleted rows are excluded automatically via the
// embedded Model.DeletedAt scope. Best-effort: a query error yields an empty
// slice (treated as "no rules", so create-time apply becomes a no-op).
func loadAccessorialCatalog(c *gin.Context) []accessorial.CatalogEntry {
	var rows []models.LogisticsAccessorialCatalog
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("status = ?", "ACTIVE").
		Limit(accessorialCatalogLimit).
		Find(&rows).Error; err != nil {
		log.Printf("[logistics] accessorial catalog load failed: %v", err)
		return nil
	}

	out := make([]accessorial.CatalogEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, accessorial.CatalogEntry{
			ID:            r.ID,
			Code:          r.Code,
			Name:          r.Name,
			ChargeType:    r.ChargeType,
			DefaultAmount: r.DefaultAmount,
			Currency:      r.Currency,
			Taxable:       r.Taxable,
			AutoApplyRule: r.AutoApplyRule,
			Status:        r.Status,
		})
	}
	return out
}

// buildShipmentAccessorialContext maps the order row to the evaluator context.
//
// The Go create path does NOT compute a rate-engine quote, so the contract
// base rate (pre-fuel) is genuinely unknown — BaseRate stays nil, and
// percentage-of-base rules simply don't fire (better than charging off a wrong
// base). CustomerRateAmount — the all-in customer rate already on the order —
// maps to Subtotal, so percentage-of-subtotal rules CAN fire off a real
// number. Distance and country codes aren't columns on the order, so per-km
// and cross-border rules stay dormant on this path; multi-drop is handled later
// in dispatch, so StopsCount is the pickup+delivery baseline of 2 (parity with
// the TS shipper-portal context).
func buildShipmentAccessorialContext(o *models.LogisticsShipmentOrder) accessorial.Context {
	stops := 2.0
	return accessorial.Context{
		BaseRate:           nil,
		Subtotal:           o.CustomerRateAmount,
		CargoValue:         o.CargoValueAmount,
		DistanceKm:         nil,
		WeightKg:           o.TotalWeightKg,
		StopsCount:         &stops,
		VehicleType:        o.RequestedVehicleType,
		ShipmentType:       o.ShipmentType,
		IsHazmat:           false, // no hazmat flag on the order row
		RequiresCustoms:    false, // no explicit customs flag on the order row
		OriginCountry:      nil,   // order carries addresses, not country codes
		DestinationCountry: nil,
	}
}

// writeAutoAccessorialCharge persists one applied accessorial as a freight
// charge and records a best-effort tracking event, mirroring the TS
// addShipmentAccessorialCharge: charge_side=CUSTOMER, billing_status=READY,
// quantity=1, unit_rate=amount=the computed amount, tax at 5% when taxable,
// total=amount+tax, and metadata tagged source/autoApplied/reason.
func writeAutoAccessorialCharge(order *models.LogisticsShipmentOrder, actorUID string, a accessorial.AppliedAccessorial) error {
	taxAmount := 0.0
	if a.Taxable {
		taxAmount = round2Money(a.Amount * accessorialVATRate)
	}

	chargeType := strings.ToUpper(strings.TrimSpace(a.Code))
	if chargeType == "" {
		chargeType = "ACCESSORIAL"
	}
	desc := strings.TrimSpace(a.Name)
	if desc == "" {
		desc = chargeType
	}
	currency := a.Currency
	if currency == "" {
		currency = order.Currency
	}
	if currency == "" {
		currency = "AED"
	}

	charge := models.LogisticsFreightCharge{
		TenantID:        order.TenantID,
		ShipmentOrderID: order.ID,
		ChargeSide:      "CUSTOMER",
		ChargeType:      chargeType,
		Description:     &desc,
		Quantity:        1,
		UnitRate:        a.Amount,
		Amount:          a.Amount,
		TaxAmount:       taxAmount,
		TotalAmount:     round2Money(a.Amount + taxAmount),
		Currency:        currency,
		BillingStatus:   "READY",
		Metadata: map[string]any{
			"source":      "logistics-accessorial",
			"catalogId":   a.CatalogID,
			"actorUserId": actorUID,
			"autoApplied": true,
			"reason":      a.Reason,
			"chargeType":  a.ChargeType,
		},
	}

	// TenantID is stamped above, so an unscoped Create is correct (and matches
	// CreateLogisticsShipment). The scope helper only injects read WHERE
	// clauses, which Create ignores.
	if err := database.DB.Create(&charge).Error; err != nil {
		return err
	}

	writeAccessorialTrackingEvent(order, charge, desc)
	return nil
}

// writeAccessorialTrackingEvent appends an ACCESSORIAL_CHARGE_ADDED row to the
// shipment timeline, matching the TS addTrackingEvent call. Strictly
// best-effort — a failure here is logged and swallowed; the money row already
// committed and is the source of truth.
func writeAccessorialTrackingEvent(order *models.LogisticsShipmentOrder, charge models.LogisticsFreightCharge, desc string) {
	status := order.Status
	notes := desc + " accessorial added"
	ev := models.LogisticsTrackingEvent{
		TenantID:        order.TenantID,
		ShipmentOrderID: order.ID,
		EventType:       "ACCESSORIAL_CHARGE_ADDED",
		Status:          &status,
		Source:          "LOGISTICS_FINANCE",
		Notes:           &notes,
		Metadata: map[string]any{
			"chargeId":    charge.ID,
			"chargeSide":  charge.ChargeSide,
			"chargeType":  charge.ChargeType,
			"amount":      charge.Amount,
			"taxAmount":   charge.TaxAmount,
			"totalAmount": charge.TotalAmount,
		},
	}
	if err := database.DB.Create(&ev).Error; err != nil {
		log.Printf("[logistics] accessorial tracking event failed for shipment %s: %v", order.ID, err)
	}
}

// round2Money rounds to 2dp, half away from zero — matching the engine's round2
// and JS Number(n.toFixed(2)) for the non-negative amounts handled here.
func round2Money(n float64) float64 { return math.Round(n*100) / 100 }

package handlers

// Logistics finance handlers (Phase L3) — the money layer: freight charges,
// carrier settlements, driver payouts, the ledger-bridge postings, and the
// headline 3-way reconciliation report.
//
// Same contract as the rest of the logistics surface: requireTenant(c) at the
// top, reads flow through auth.WithTenant(c) so tenant isolation is enforced in
// exactly one place.
//
// Parity source: src/lib/logistics/domain.ts — the finance tables (lines
// 1139-1214) and getLogisticsFinanceReconciliation (line 8067). Note that in the
// Next.js codebase these finance functions are NOT exposed via any HTTP route;
// they fire internally during awardCarrierBid. This increment gives the finance
// DATA a clean, tenant-scoped read surface in Go — the architectural goal of the
// migration (every logistics query behind one enforcement point), independent of
// the award orchestration that still lives in Next.js during dual-run.
//
// SCOPE — this increment is READ-ONLY. The write path that produces these rows
// (prepareFreightFinancialSettlement → postFreightSettlementToFinance, which also
// writes the shared finance_invoices / finance_journal_entries ledger) is ported
// in a follow-up increment, where the journal-balancing and number-generation
// logic gets a pure, unit-tested home. Reads migrate first because they carry no
// double-write risk in the dual-run window.

import (
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
)

// ── Freight charges ──────────────────────────────────────────────────────────

// GetLogisticsFreightCharges lists billable lines, newest first.
//
//	?shipmentOrderId=  scope to one shipment
//	?chargeSide=       CUSTOMER | CARRIER
//	?billingStatus=    DRAFT | READY | POSTED
//	?limit=  ?offset=
func GetLogisticsFreightCharges(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsFreightCharge{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("chargeSide")); v != "" {
		q = q.Where("charge_side = ?", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("billingStatus")); v != "" {
		q = q.Where("billing_status = ?", strings.ToUpper(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsFreightCharge
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// ── Carrier settlements ──────────────────────────────────────────────────────

// GetLogisticsCarrierSettlements lists carrier statements, newest first.
//
//	?carrierId=  scope to one carrier
//	?status=     DRAFT | READY | POSTED | REVERSED
//	?limit=  ?offset=
func GetLogisticsCarrierSettlements(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsCarrierSettlement{})
	if v := strings.TrimSpace(c.Query("carrierId")); v != "" {
		q = q.Where("carrier_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status = ?", strings.ToUpper(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsCarrierSettlement
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// ── Driver payouts ───────────────────────────────────────────────────────────

// GetLogisticsDriverPayouts lists driver earnings, newest first.
//
//	?shipmentOrderId=  scope to one shipment
//	?driverId=         scope to one driver
//	?status=           DRAFT | READY | POSTED | REVERSED
//	?limit=  ?offset=
func GetLogisticsDriverPayouts(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsDriverPayout{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("driverId")); v != "" {
		q = q.Where("driver_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status = ?", strings.ToUpper(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsDriverPayout
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// ── Finance postings ─────────────────────────────────────────────────────────

// GetLogisticsFinancePostings lists the ledger-bridge rows, newest first.
//
//	?shipmentOrderId=  scope to one shipment
//	?postingType=      CUSTOMER_INVOICE | CARRIER_PAYABLE | CARRIER_SETTLEMENT | DRIVER_PAYOUT
//	?status=           POSTED | REVERSED
//	?limit=  ?offset=
func GetLogisticsFinancePostings(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsFinancePosting{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("postingType")); v != "" {
		q = q.Where("posting_type = ?", strings.ToUpper(v))
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status = ?", strings.ToUpper(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsFinancePosting
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// ── 3-way reconciliation ─────────────────────────────────────────────────────

const (
	reconDefaultLimit = 100
	reconMaxLimit     = 500
	reconToleranceAED = 0.01 // |charges - posted| under this counts as reconciled
)

// financeReconRow is the scan target for the aggregate query. The money columns
// are cast to ::float8 and the counts to ::bigint in SQL so the pgx driver hands
// back clean Go scalars (raw NUMERIC/COUNT types scan inconsistently).
type financeReconRow struct {
	ShipmentOrderID            string  `gorm:"column:shipment_order_id"`
	ShipmentNo                 string  `gorm:"column:shipment_no"`
	CargoOwnerName             *string `gorm:"column:cargo_owner_name"`
	Status                     string  `gorm:"column:status"`
	Currency                   string  `gorm:"column:currency"`
	CustomerChargeTotal        float64 `gorm:"column:customer_charge_total"`
	CarrierChargeTotal         float64 `gorm:"column:carrier_charge_total"`
	AccessorialTotal           float64 `gorm:"column:accessorial_total"`
	PostedCustomerInvoiceTotal float64 `gorm:"column:posted_customer_invoice_total"`
	PostedCarrierPayableTotal  float64 `gorm:"column:posted_carrier_payable_total"`
	ReversedTotal              float64 `gorm:"column:reversed_total"`
	ActivePostingCount         int64   `gorm:"column:active_posting_count"`
	ReversedPostingCount       int64   `gorm:"column:reversed_posting_count"`
}

// financeReconShipment is one row of the report, mirroring the camelCase shape
// the Next.js getLogisticsFinanceReconciliation returns.
type financeReconShipment struct {
	ShipmentOrderID            string  `json:"shipmentOrderId"`
	ShipmentNo                 string  `json:"shipmentNo"`
	CustomerName               *string `json:"customerName"`
	Status                     string  `json:"status"`
	Currency                   string  `json:"currency"`
	CustomerCharges            float64 `json:"customerCharges"`
	CarrierCharges             float64 `json:"carrierCharges"`
	AccessorialTotal           float64 `json:"accessorialTotal"`
	PostedCustomerInvoiceTotal float64 `json:"postedCustomerInvoiceTotal"`
	PostedCarrierPayableTotal  float64 `json:"postedCarrierPayableTotal"`
	ReversedTotal              float64 `json:"reversedTotal"`
	ActivePostingCount         int64   `json:"activePostingCount"`
	ReversedPostingCount       int64   `json:"reversedPostingCount"`
	CustomerReconciled         bool    `json:"customerReconciled"`
	CarrierReconciled          bool    `json:"carrierReconciled"`
}

// GetLogisticsFinanceReconciliation reports, per shipment, the freight charged
// (by side) against what was actually posted to the ledger, flagging any
// shipment where the two diverge by more than 0.01. Faithful port of
// getLogisticsFinanceReconciliation.
//
// This is a raw aggregate (Postgres FILTER clauses), so GORM Scopes don't apply
// — tenant isolation is enforced by binding the token's tenant into
// `WHERE so.tenant_id = ?` from requireTenant(c). The join predicates also pin
// fc/fp to so.tenant_id, so no other tenant's charges or postings can leak in.
//
//	?limit=  rows, clamped to [1, 500] (default 100)
func GetLogisticsFinanceReconciliation(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	limit := reconDefaultLimit
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	if limit < 1 {
		limit = 1
	}
	if limit > reconMaxLimit {
		limit = reconMaxLimit
	}

	const query = `
SELECT so.id AS shipment_order_id,
       so.shipment_no,
       so.cargo_owner_name,
       so.status,
       so.currency,
       COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CUSTOMER'), 0)::float8 AS customer_charge_total,
       COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CARRIER'), 0)::float8 AS carrier_charge_total,
       COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_type NOT IN ('CUSTOMER_FREIGHT','CARRIER_FREIGHT')), 0)::float8 AS accessorial_total,
       COALESCE(SUM(fp.amount) FILTER (WHERE fp.posting_type = 'CUSTOMER_INVOICE' AND fp.status = 'POSTED'), 0)::float8 AS posted_customer_invoice_total,
       COALESCE(SUM(fp.amount) FILTER (WHERE fp.posting_type IN ('CARRIER_PAYABLE','CARRIER_SETTLEMENT') AND fp.status = 'POSTED'), 0)::float8 AS posted_carrier_payable_total,
       COALESCE(SUM(fp.amount) FILTER (WHERE fp.status = 'REVERSED'), 0)::float8 AS reversed_total,
       (COUNT(DISTINCT fp.id) FILTER (WHERE fp.status = 'POSTED'))::bigint AS active_posting_count,
       (COUNT(DISTINCT fp.id) FILTER (WHERE fp.status = 'REVERSED'))::bigint AS reversed_posting_count
  FROM logistics_shipment_orders so
  LEFT JOIN logistics_freight_charges fc
    ON fc.shipment_order_id = so.id
   AND fc.tenant_id = so.tenant_id
  LEFT JOIN logistics_finance_postings fp
    ON fp.shipment_order_id = so.id
   AND fp.tenant_id = so.tenant_id
 WHERE so.tenant_id = ?
   AND so.deleted_at IS NULL
 GROUP BY so.id
 ORDER BY so.updated_at DESC
 LIMIT ?`

	var rows []financeReconRow
	if err := database.DB.Raw(query, tid, limit).Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	shipments := make([]financeReconShipment, 0, len(rows))
	var (
		customerChargeTotal  float64
		carrierChargeTotal   float64
		accessorialTotal     float64
		unreconciledCustomer int
		unreconciledCarrier  int
		reversedPostings     int64
	)
	for _, r := range rows {
		customerReconciled := math.Abs(r.CustomerChargeTotal-r.PostedCustomerInvoiceTotal) < reconToleranceAED
		carrierReconciled := math.Abs(r.CarrierChargeTotal-r.PostedCarrierPayableTotal) < reconToleranceAED

		shipments = append(shipments, financeReconShipment{
			ShipmentOrderID:            r.ShipmentOrderID,
			ShipmentNo:                 r.ShipmentNo,
			CustomerName:               r.CargoOwnerName,
			Status:                     r.Status,
			Currency:                   r.Currency,
			CustomerCharges:            r.CustomerChargeTotal,
			CarrierCharges:             r.CarrierChargeTotal,
			AccessorialTotal:           r.AccessorialTotal,
			PostedCustomerInvoiceTotal: r.PostedCustomerInvoiceTotal,
			PostedCarrierPayableTotal:  r.PostedCarrierPayableTotal,
			ReversedTotal:              r.ReversedTotal,
			ActivePostingCount:         r.ActivePostingCount,
			ReversedPostingCount:       r.ReversedPostingCount,
			CustomerReconciled:         customerReconciled,
			CarrierReconciled:          carrierReconciled,
		})

		customerChargeTotal += r.CustomerChargeTotal
		carrierChargeTotal += r.CarrierChargeTotal
		accessorialTotal += r.AccessorialTotal
		if !customerReconciled {
			unreconciledCustomer++
		}
		if !carrierReconciled {
			unreconciledCarrier++
		}
		reversedPostings += r.ReversedPostingCount
	}

	c.JSON(http.StatusOK, gin.H{
		"generatedAt": time.Now().UTC().Format("2006-01-02T15:04:05.000Z07:00"),
		"summary": gin.H{
			"shipments":            len(shipments),
			"customerChargeTotal":  customerChargeTotal,
			"carrierChargeTotal":   carrierChargeTotal,
			"accessorialTotal":     accessorialTotal,
			"unreconciledCustomer": unreconciledCustomer,
			"unreconciledCarrier":  unreconciledCarrier,
			"reversedPostings":     reversedPostings,
		},
		"shipments": shipments,
	})
}

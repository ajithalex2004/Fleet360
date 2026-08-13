package handlers

// Logistics marketplace handlers (Phase L1) — carriers, rate contracts, and
// the rate-quote endpoint. Same contract as logistics.go: requireTenant(c) at
// the top, reads through auth.WithTenant(c), creates stamp TenantID from the
// validated token.
//
// The quote endpoint is the headline of this phase: it is the Go-native
// replacement for src/app/api/logistics/rates/quote, loading tenant-scoped
// candidate contracts via GORM and handing them to the pure rateengine.Quote
// (ported from src/lib/logistics/rate-engine.ts). The lane lookup +
// vehicle/service hard filter mirrors domain.ts matchLaneRateContracts; the
// scoring, effective-date gating and pricing live in the engine package.

import (
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"
	"fleet360-backend/rateengine"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	defaultCarrierPageSize  = 100
	maxCarrierPageSize      = 500
	defaultContractPageSize = 100
	maxContractPageSize     = 500
	// quoteCandidateLimit bounds how many lane-matching contracts the quote
	// endpoint pulls before scoring — matches matchLaneRateContracts' limit 20.
	quoteCandidateLimit = 20
)

// ── Carriers ───────────────────────────────────────────────────────────────

// GetLogisticsCarriers lists carriers for the tenant, newest first.
//
//	?status=ACTIVE,SUSPENDED   comma-separated status allow-list
//	?search=acme               matches name / carrier_code / trade_license
//	?limit=  ?offset=          pagination (limit capped at maxCarrierPageSize)
func GetLogisticsCarriers(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultCarrierPageSize, maxCarrierPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsCarrier{})
	if s := strings.TrimSpace(c.Query("status")); s != "" {
		q = q.Where("status IN ?", splitCSV(s))
	}
	if search := strings.TrimSpace(c.Query("search")); search != "" {
		like := "%" + search + "%"
		q = q.Where("name ILIKE ? OR carrier_code ILIKE ? OR trade_license ILIKE ?", like, like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var carriers []models.LogisticsCarrier
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&carriers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": carriers, "total": total, "limit": limit, "offset": offset})
}

// GetLogisticsCarrier returns one carrier by id, tenant-scoped (404 hides
// cross-tenant ids the same way the shipment endpoint does).
func GetLogisticsCarrier(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var carrier models.LogisticsCarrier
	err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", c.Param("id")).First(&carrier).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "carrier not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, carrier)
}

// CreateLogisticsCarrier inserts a carrier. TenantID comes from the token.
func CreateLogisticsCarrier(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsCarrier
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	input.ID = ""
	input.TenantID = tid
	if input.CarrierType == "" {
		input.CarrierType = "TRANSPORT_COMPANY"
	}
	if input.Status == "" {
		input.Status = "ACTIVE"
	}
	if input.OnboardingStatus == "" {
		input.OnboardingStatus = "DRAFT"
	}
	if input.ComplianceStatus == "" {
		input.ComplianceStatus = "PENDING"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Rate contracts ───────────────────────────────────────────────────────────

// GetLogisticsRateContracts lists rate contracts for the tenant.
//
//	?customerId=  ?carrierId=  ?status=
//	?origin=  ?destination=    lane substring filters (ILIKE)
//	?search=                   contract_no / customer_name / lane / carrier name
//	?limit=  ?offset=
func GetLogisticsRateContracts(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultContractPageSize, maxContractPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsRateContract{})
	if v := strings.TrimSpace(c.Query("customerId")); v != "" {
		q = q.Where("customer_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("carrierId")); v != "" {
		q = q.Where("carrier_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status IN ?", splitCSV(v))
	}
	if v := strings.TrimSpace(c.Query("origin")); v != "" {
		q = q.Where("lane_origin ILIKE ?", "%"+v+"%")
	}
	if v := strings.TrimSpace(c.Query("destination")); v != "" {
		q = q.Where("lane_destination ILIKE ?", "%"+v+"%")
	}
	if v := strings.TrimSpace(c.Query("search")); v != "" {
		like := "%" + v + "%"
		q = q.Where(
			"contract_no ILIKE ? OR customer_name ILIKE ? OR lane_origin ILIKE ? OR lane_destination ILIKE ?",
			like, like, like, like,
		)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var contracts []models.LogisticsRateContract
	// Mirror the Next.js ordering: effective_from desc (nulls last), then most
	// recently updated, so the freshest applicable rate sorts to the top.
	if err := q.Order("effective_from DESC NULLS LAST").Order("updated_at DESC").
		Limit(limit).Offset(offset).Find(&contracts).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": contracts, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsRateContract inserts a rate contract. contract_no is
// generated in the model BeforeCreate hook when omitted. Lane endpoints are
// required (parity with upsertRateContract, which throws without them).
func CreateLogisticsRateContract(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsRateContract
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.LaneOrigin) == "" || strings.TrimSpace(input.LaneDestination) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "laneOrigin and laneDestination are required"})
		return
	}

	input.ID = ""
	input.TenantID = tid
	if input.Currency == "" {
		input.Currency = "AED"
	}
	if input.Status == "" {
		input.Status = "ACTIVE"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Rate quote ───────────────────────────────────────────────────────────────

// rateQuoteRequest is the POST body for /logistics/rates/quote. tenantId is
// NOT accepted from the body — it always comes from the token.
type rateQuoteRequest struct {
	Origin       string  `json:"origin"`
	Destination  string  `json:"destination"`
	VehicleType  *string `json:"vehicleType"`
	ServiceLevel *string `json:"serviceLevel"`
	CustomerID   *string `json:"customerId"`
	CarrierID    *string `json:"carrierId"`
	// ShipmentDate is an ISO date (YYYY-MM-DD or full RFC3339). Defaults to
	// today when omitted, matching quoteShipment's `?? new Date()`.
	ShipmentDate *string `json:"shipmentDate"`
	// DistanceKm / WeightKg drive per-km / per-kg / breakpoint pricing. Omitted
	// → a quantity-based contract falls back to its flat base_rate.
	DistanceKm *float64 `json:"distanceKm"`
	WeightKg   *float64 `json:"weightKg"`
	// SpotPerKmRate, when set, overrides the configured default for the
	// no-contract spot-estimate fallback (operator-supplied indicative rate).
	SpotPerKmRate *float64 `json:"spotPerKmRate"`
}

// PostLogisticsRateQuote computes a freight quote for a lane. It loads the
// tenant's ACTIVE lane-matching contracts (NOT filtered by customer/carrier in
// SQL — generic and customer-specific must compete, exactly as the Next.js
// quoteShipment does), applies the vehicle/service hard filter from
// matchLaneRateContracts, then defers all scoring/gating/pricing to the pure
// rateengine.Quote so the business logic stays unit-tested and DB-free.
func PostLogisticsRateQuote(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	var req rateQuoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Origin = strings.TrimSpace(req.Origin)
	req.Destination = strings.TrimSpace(req.Destination)
	if req.Origin == "" || req.Destination == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "origin and destination are required"})
		return
	}

	shipDate, err := parseShipmentDate(req.ShipmentDate)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid shipmentDate: " + err.Error()})
		return
	}

	// Lane candidates: ACTIVE + lane substring match, tenant-scoped. We pull
	// all of them (no customer/carrier SQL filter) and let the engine scope,
	// so a generic contract and a customer-specific one can compete.
	var rows []models.LogisticsRateContract
	q := database.DB.Scopes(auth.WithTenant(c)).
		Where("status = ?", "ACTIVE").
		Where("lane_origin ILIKE ?", "%"+req.Origin+"%").
		Where("lane_destination ILIKE ?", "%"+req.Destination+"%").
		Limit(quoteCandidateLimit)
	if err := q.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Vehicle/service hard filter — parity with matchLaneRateContracts: keep a
	// contract when the request didn't ask for that attribute, OR the contract
	// is generic on it, OR they match (case-insensitive).
	reqVeh := upperPtr(req.VehicleType)
	reqSvc := upperPtr(req.ServiceLevel)
	candidates := make([]rateengine.Candidate, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		if reqVeh != "" && r.VehicleType != nil && !strings.EqualFold(*r.VehicleType, reqVeh) {
			continue
		}
		if reqSvc != "" && r.ServiceLevel != nil && !strings.EqualFold(*r.ServiceLevel, reqSvc) {
			continue
		}
		candidates = append(candidates, toCandidate(r))
	}

	engineReq := rateengine.Request{
		CustomerID:   req.CustomerID,
		CarrierID:    req.CarrierID,
		VehicleType:  req.VehicleType,
		ServiceLevel: req.ServiceLevel,
		ShipmentDate: shipDate,
		DistanceKm:   req.DistanceKm,
		WeightKg:     req.WeightKg,
	}
	result := rateengine.Quote(candidates, engineReq)

	// Spot-market fallback: when no contract priced the lane, give the operator
	// an indicative distance×rate estimate rather than a dead end — but ONLY a
	// labelled, non-contracted one (Matched stays false), so rate-coverage
	// analytics still flag the lane as uncontracted. No-op unless a default per-km
	// rate is configured AND a distance was supplied.
	if !result.Matched &&
		(result.Reason == rateengine.ReasonNoLaneMatch || result.Reason == rateengine.ReasonNoActiveContract) {
		if rate := resolveSpotPerKmRate(req.SpotPerKmRate, req.VehicleType); rate > 0 {
			if est, ok := rateengine.SpotEstimate(engineReq, rate, spotMinCharge()); ok {
				result = est
			}
		}
	}

	c.JSON(http.StatusOK, result)
}

// resolveSpotPerKmRate picks the default per-km rate for the spot-estimate
// fallback, first hit wins: (1) a rate the caller supplied on the request
// (operator override), (2) a per-vehicle-type env override
// LOGISTICS_SPOT_PER_KM_RATE_<TYPE> (type upper-cased, non-alphanumerics → _),
// (3) the global env LOGISTICS_SPOT_PER_KM_RATE. Returns 0 when none is set, so
// the fallback stays inert (and the quote keeps its honest no-match) until a
// tenant/deployment opts in. Per-tenant config is a future enhancement (no
// tenant_settings column exists for it yet).
func resolveSpotPerKmRate(override *float64, vehicleType *string) float64 {
	if override != nil && *override > 0 {
		return *override
	}
	if vehicleType != nil {
		key := spotEnvKey(*vehicleType)
		if key != "" {
			if v := envFloat("LOGISTICS_SPOT_PER_KM_RATE_" + key); v > 0 {
				return v
			}
		}
	}
	return envFloat("LOGISTICS_SPOT_PER_KM_RATE")
}

// spotMinCharge is the optional floor applied to a spot estimate (e.g. so a
// 5km move doesn't quote a few dirhams). 0/unset → no floor.
func spotMinCharge() *float64 {
	if v := envFloat("LOGISTICS_SPOT_MIN_CHARGE"); v > 0 {
		return &v
	}
	return nil
}

// spotEnvKey upper-cases a vehicle type and replaces any non-alphanumeric run
// with a single underscore so it forms a valid env-var suffix ("3-Ton" → "3_TON").
func spotEnvKey(vehicleType string) string {
	var b strings.Builder
	prevUnderscore := false
	for _, r := range strings.ToUpper(strings.TrimSpace(vehicleType)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevUnderscore = false
		} else if !prevUnderscore {
			b.WriteByte('_')
			prevUnderscore = true
		}
	}
	return strings.Trim(b.String(), "_")
}

// envFloat reads a non-negative float from an env var, or 0 when unset/invalid.
func envFloat(name string) float64 {
	v := strings.TrimSpace(os.Getenv(name))
	if v == "" {
		return 0
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f < 0 {
		return 0
	}
	return f
}

// toCandidate flattens a rate-contract row into the engine's input shape.
func toCandidate(r *models.LogisticsRateContract) rateengine.Candidate {
	return rateengine.Candidate{
		ID:               r.ID,
		ContractNo:       r.ContractNo,
		CustomerID:       r.CustomerID,
		CarrierID:        r.CarrierID,
		VehicleType:      r.VehicleType,
		ServiceLevel:     r.ServiceLevel,
		BaseRate:         r.BaseRate,
		FuelSurchargePct: r.FuelSurchargePct,
		MinCharge:        r.MinCharge,
		// Rate basis (per-km / per-kg / breakpoints) rides in metadata JSONB —
		// no rate_basis column exists and Go doesn't own the schema. nil for
		// contracts that price flat off base_rate.
		RateBasis:        rateengine.ParseRateBasis(r.Metadata),
		EffectiveFrom:    r.EffectiveFrom,
		EffectiveTo:      r.EffectiveTo,
		Status:           r.Status,
		Currency:         r.Currency,
		AccessorialRules: r.AccessorialRules,
		CreatedAt:        r.CreatedAt,
	}
}

// ── Freight RFQs ─────────────────────────────────────────────────────────────

const (
	defaultRFQPageSize = 100
	maxRFQPageSize     = 500
)

// GetLogisticsRFQs lists RFQs for the tenant, newest first.
//
//	?shipmentOrderId=  scope to one shipment
//	?status=DRAFT,OPEN comma-separated allow-list
//	?limit=  ?offset=
func GetLogisticsRFQs(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultRFQPageSize, maxRFQPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsFreightRFQ{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status IN ?", splitCSV(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rfqs []models.LogisticsFreightRFQ
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rfqs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	shipmentIDs := make([]string, 0, len(rfqs))
	for _, rfq := range rfqs {
		if strings.TrimSpace(rfq.ShipmentOrderID) != "" {
			shipmentIDs = append(shipmentIDs, rfq.ShipmentOrderID)
		}
	}
	shipments := loadRFQShipmentSummaries(c, shipmentIDs)
	bidCounts := loadRFQBidCounts(c, rfqs)

	data := make([]gin.H, 0, len(rfqs))
	for _, rfq := range rfqs {
		data = append(data, gin.H{
			"id":               rfq.ID,
			"createdAt":        rfq.CreatedAt,
			"updatedAt":        rfq.UpdatedAt,
			"tenantId":         rfq.TenantID,
			"shipmentOrderId":  rfq.ShipmentOrderID,
			"rfqNo":            rfq.RFQNo,
			"status":           rfq.Status,
			"inviteScope":      rfq.InviteScope,
			"bidDeadlineAt":    rfq.BidDeadlineAt,
			"negotiationRound": rfq.NegotiationRound,
			"awardedBidId":     rfq.AwardedBidID,
			"metadata":         rfq.Metadata,
			"bidCount":         bidCounts[rfq.ID],
			"shipment":         shipments[rfq.ShipmentOrderID],
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsRFQ posts an RFQ against a shipment order. rfq_no is generated
// in the model BeforeCreate hook. shipmentOrderId is required.
func CreateLogisticsRFQ(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input struct {
		models.LogisticsFreightRFQ
		InvitedCarrierIDs []string `json:"invitedCarrierIds"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.ShipmentOrderID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shipmentOrderId is required"})
		return
	}

	input.ID = ""
	input.TenantID = tid
	if input.Status == "" {
		input.Status = "OPEN"
	}
	if input.InviteScope == "" {
		input.InviteScope = "SELECTED_CARRIERS"
	}
	if input.InviteScope == "SELECTED_CARRIERS" && len(input.InvitedCarrierIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invitedCarrierIds is required for SELECTED_CARRIERS"})
		return
	}
	if input.NegotiationRound == 0 {
		input.NegotiationRound = 1
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	if len(input.InvitedCarrierIDs) > 0 {
		input.Metadata["invitedCarrierIds"] = input.InvitedCarrierIDs
	}

	if err := database.DB.Create(&input.LogisticsFreightRFQ).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	_ = database.DB.Scopes(auth.WithTenant(c)).
		Model(&models.LogisticsShipmentOrder{}).
		Where("id = ?", input.ShipmentOrderID).
		Updates(map[string]any{"marketplace_status": "OPEN", "updated_at": time.Now()}).
		Error
	c.JSON(http.StatusCreated, input.LogisticsFreightRFQ)
}

// ── Carrier bids ─────────────────────────────────────────────────────────────

// GetLogisticsBids lists carrier bids for the tenant.
//
//	?shipmentOrderId=  ?rfqId=  ?carrierId=  ?status=
//	?limit=  ?offset=
func GetLogisticsBids(c *gin.Context) {
	getLogisticsBids(c, "")
}

// GetLogisticsRFQBids keeps the existing UI path
// /api/logistics/rfqs/:id/bids working when the compatibility shim forwards to
// Go's /api/v1 surface.
func GetLogisticsRFQBids(c *gin.Context) {
	getLogisticsBids(c, c.Param("id"))
}

func getLogisticsBids(c *gin.Context, forcedRFQID string) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultRFQPageSize, maxRFQPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsCarrierBid{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if forcedRFQID != "" {
		q = q.Where("rfq_id = ?", forcedRFQID)
	} else if v := strings.TrimSpace(c.Query("rfqId")); v != "" {
		q = q.Where("rfq_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("carrierId")); v != "" {
		q = q.Where("carrier_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status IN ?", splitCSV(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var bids []models.LogisticsCarrierBid
	// Cheapest first within a shipment is what the award UI wants; created_at
	// breaks ties deterministically.
	if err := q.Order("amount ASC").Order("created_at ASC").
		Limit(limit).Offset(offset).Find(&bids).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	carrierIDs := make([]string, 0, len(bids))
	for _, bid := range bids {
		carrierIDs = append(carrierIDs, bid.CarrierID)
	}
	carriers := loadCarrierNames(c, carrierIDs)
	data := make([]gin.H, 0, len(bids))
	for _, bid := range bids {
		data = append(data, gin.H{
			"id":               bid.ID,
			"createdAt":        bid.CreatedAt,
			"updatedAt":        bid.UpdatedAt,
			"tenantId":         bid.TenantID,
			"shipmentOrderId":  bid.ShipmentOrderID,
			"rfqId":            bid.RFQID,
			"carrierId":        bid.CarrierID,
			"carrierName":      carriers[bid.CarrierID],
			"bidNo":            bid.BidNo,
			"amount":           bid.Amount,
			"currency":         bid.Currency,
			"transitTimeHours": bid.TransitTimeHours,
			"validityUntil":    bid.ValidityUntil,
			"status":           bid.Status,
			"chargeBreakdown":  bid.ChargeBreakdown,
			"notes":            bid.Notes,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsBid records a carrier's offer on a shipment. bid_no is
// generated in the model hook. carrierId, shipmentOrderId and a positive
// amount are required.
func CreateLogisticsBid(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsCarrierBid
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.ShipmentOrderID) == "" || strings.TrimSpace(input.CarrierID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shipmentOrderId and carrierId are required"})
		return
	}
	if input.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "amount must be greater than zero"})
		return
	}

	input.ID = ""
	input.TenantID = tid
	if input.Currency == "" {
		input.Currency = "AED"
	}
	if input.Status == "" {
		input.Status = "SUBMITTED"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Carrier scorecards ───────────────────────────────────────────────────────

type rfqShipmentSummary struct {
	Origin       *string `json:"origin"`
	Destination  *string `json:"destination"`
	CustomerName *string `json:"customerName"`
	VehicleType  *string `json:"vehicleType"`
}

func loadRFQShipmentSummaries(c *gin.Context, shipmentIDs []string) map[string]rfqShipmentSummary {
	out := map[string]rfqShipmentSummary{}
	if len(shipmentIDs) == 0 {
		return out
	}

	var rows []struct {
		ID          string
		Origin      *string
		Destination *string
		Customer    *string
		VehicleType *string
	}
	err := database.DB.Scopes(auth.WithTenant(c)).
		Table("logistics_shipment_orders").
		Select("id, COALESCE(origin_name, origin_address) AS origin, COALESCE(destination_name, destination_address) AS destination, cargo_owner_name AS customer, requested_vehicle_type AS vehicle_type").
		Where("id IN ?", shipmentIDs).
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for _, row := range rows {
		out[row.ID] = rfqShipmentSummary{
			Origin:       row.Origin,
			Destination:  row.Destination,
			CustomerName: row.Customer,
			VehicleType:  row.VehicleType,
		}
	}
	return out
}

func loadRFQBidCounts(c *gin.Context, rfqs []models.LogisticsFreightRFQ) map[string]int64 {
	out := map[string]int64{}
	ids := make([]string, 0, len(rfqs))
	for _, rfq := range rfqs {
		ids = append(ids, rfq.ID)
		out[rfq.ID] = 0
	}
	if len(ids) == 0 {
		return out
	}

	var rows []struct {
		RFQID string
		Total int64
	}
	err := database.DB.Scopes(auth.WithTenant(c)).
		Table("logistics_carrier_bids").
		Select("rfq_id, COUNT(*) AS total").
		Where("rfq_id IN ?", ids).
		Group("rfq_id").
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for _, row := range rows {
		out[row.RFQID] = row.Total
	}
	return out
}

func loadCarrierNames(c *gin.Context, carrierIDs []string) map[string]*string {
	out := map[string]*string{}
	if len(carrierIDs) == 0 {
		return out
	}

	var rows []struct {
		ID   string
		Name *string
	}
	err := database.DB.Scopes(auth.WithTenant(c)).
		Table("logistics_carriers").
		Select("id, name").
		Where("id IN ?", carrierIDs).
		Scan(&rows).Error
	if err != nil {
		return out
	}
	for _, row := range rows {
		out[row.ID] = row.Name
	}
	return out
}

// GetLogisticsCarrierScorecards lists scorecards for the tenant.
//
//	?carrierId=  ?status=  ?preferred=true  ?blacklisted=true
//	?limit=  ?offset=
func GetLogisticsCarrierScorecards(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultCarrierPageSize, maxCarrierPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsCarrierScorecard{})
	if v := strings.TrimSpace(c.Query("carrierId")); v != "" {
		q = q.Where("carrier_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status IN ?", splitCSV(v))
	}
	if v := strings.TrimSpace(c.Query("preferred")); v != "" {
		q = q.Where("preferred = ?", strings.EqualFold(v, "true"))
	}
	if v := strings.TrimSpace(c.Query("blacklisted")); v != "" {
		q = q.Where("blacklisted = ?", strings.EqualFold(v, "true"))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var cards []models.LogisticsCarrierScorecard
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&cards).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": cards, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsCarrierScorecard records a periodic carrier scorecard.
// carrierId is required.
func CreateLogisticsCarrierScorecard(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsCarrierScorecard
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.CarrierID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "carrierId is required"})
		return
	}

	input.ID = ""
	input.TenantID = tid
	if input.Status == "" {
		input.Status = "ACTIVE"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── small shared helpers ─────────────────────────────────────────────────────

// pageParams reads ?limit/?offset with a default and hard cap, matching the
// shipment list's clamping behaviour.
func pageParams(c *gin.Context, def, max int) (limit, offset int) {
	limit = def
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > max {
		limit = max
	}
	if v := c.Query("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			offset = n
		}
	}
	return limit, offset
}

// upperPtr returns the trimmed upper-cased value of a *string, or "" for nil.
func upperPtr(s *string) string {
	if s == nil {
		return ""
	}
	return strings.ToUpper(strings.TrimSpace(*s))
}

// parseShipmentDate accepts an ISO date (YYYY-MM-DD) or full RFC3339 timestamp,
// defaulting to the current day when nil/empty. The engine only compares the
// date portion, so we normalise to midnight UTC.
func parseShipmentDate(s *string) (time.Time, error) {
	if s == nil || strings.TrimSpace(*s) == "" {
		n := time.Now().UTC()
		return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	v := strings.TrimSpace(*s)
	if len(v) >= 10 {
		if t, err := time.Parse("2006-01-02", v[:10]); err == nil {
			return t, nil
		}
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
}

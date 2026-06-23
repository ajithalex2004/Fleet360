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

	result := rateengine.Quote(candidates, rateengine.Request{
		CustomerID:   req.CustomerID,
		CarrierID:    req.CarrierID,
		VehicleType:  req.VehicleType,
		ServiceLevel: req.ServiceLevel,
		ShipmentDate: shipDate,
	})

	c.JSON(http.StatusOK, result)
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
	c.JSON(http.StatusOK, gin.H{"data": rfqs, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsRFQ posts an RFQ against a shipment order. rfq_no is generated
// in the model BeforeCreate hook. shipmentOrderId is required.
func CreateLogisticsRFQ(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.LogisticsFreightRFQ
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
		input.Status = "DRAFT"
	}
	if input.InviteScope == "" {
		input.InviteScope = "SELECTED_CARRIERS"
	}
	if input.NegotiationRound == 0 {
		input.NegotiationRound = 1
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Carrier bids ─────────────────────────────────────────────────────────────

// GetLogisticsBids lists carrier bids for the tenant.
//
//	?shipmentOrderId=  ?rfqId=  ?carrierId=  ?status=
//	?limit=  ?offset=
func GetLogisticsBids(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}

	limit, offset := pageParams(c, defaultRFQPageSize, maxRFQPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsCarrierBid{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("rfqId")); v != "" {
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
	c.JSON(http.StatusOK, gin.H{"data": bids, "total": total, "limit": limit, "offset": offset})
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

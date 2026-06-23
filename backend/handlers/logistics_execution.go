package handlers

// Logistics execution handlers (Phase L2) — the trip layer: multi-stop stops,
// route legs, carrier/driver assignments, GPS tracking, telematics, proof of
// delivery, and shipment exceptions. Plus the headline GPS-ingest endpoint
// (POST /shipments/:id/tracking) that stores a ping and then, best-effort,
// recomputes the shipment ETA and evaluates geofences.
//
// Same contract as the rest of the logistics surface: requireTenant(c) at the
// top, reads/writes through auth.WithTenant(c), creates stamp TenantID from the
// validated token (never the body).
//
// Parity sources (the Next.js code this replaces):
//   - src/app/api/logistics/shipments/[id]/tracking/route.ts  (ingest contract)
//   - src/lib/logistics/eta-notifier.ts                        (recompute + notify)
//   - src/lib/logistics/geofence-service.ts                    (geofence raise)
//
// DEFERRED — notification sends. The Next.js services send SMS/email (Twilio +
// SMTP) on a material ETA shift and on route DEVIATION. The Go backend has no
// SMS/email port yet, so this handler computes the notify DECISION and raises
// the exception row, but does NOT send. The response carries the decision and a
// `notificationsDeferred: true` flag so callers (and the eventual cutover) can
// see exactly what would have been sent. This is intentional for the
// strangler/dual-run window: the old route still owns the actual sends until an
// SMS/email port lands in a later increment.

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/etapredict"
	"fleet360-backend/geo"
	"fleet360-backend/geofence"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	defaultExecutionPageSize = 100
	maxExecutionPageSize     = 500

	// Geofence corridor/zone constants — parity with geofence-service.ts.
	defaultStopRadiusM          = 200.0
	straightLineCorridorWidthM  = 5000.0 // generous: gross deviation only (no road geometry)
	routePolylineCorridorWidthM = 800.0  // tight: used when a real route polyline exists
	geofenceDedupWindowMinutes  = 5

	// recentPingWindow is how many recent GPS pings the ETA predictor looks at,
	// matching recomputeShipmentEta's `LIMIT 10`.
	recentPingWindow = 10
)

// ── Stops ─────────────────────────────────────────────────────────────────────

// GetLogisticsStops lists a shipment's stops, ordered by sequence_no.
//
//	?shipmentOrderId=  scope to one shipment (recommended)
//	?limit=  ?offset=
func GetLogisticsStops(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentStop{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var stops []models.LogisticsShipmentStop
	if err := q.Order("shipment_order_id ASC").Order("sequence_no ASC").
		Limit(limit).Offset(offset).Find(&stops).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": stops, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsStop adds a stop to a shipment. shipmentOrderId and stopType
// are required (both NOT NULL in the schema).
func CreateLogisticsStop(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsShipmentStop
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.ShipmentOrderID) == "" || strings.TrimSpace(input.StopType) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shipmentOrderId and stopType are required"})
		return
	}
	input.ID = ""
	input.TenantID = tid
	if input.Status == "" {
		input.Status = "PLANNED"
	}
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Route legs ──────────────────────────────────────────────────────────────

// GetLogisticsRouteLegs lists a shipment's route legs, ordered by sequence_no.
func GetLogisticsRouteLegs(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsRouteLeg{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var legs []models.LogisticsRouteLeg
	if err := q.Order("shipment_order_id ASC").Order("sequence_no ASC").
		Limit(limit).Offset(offset).Find(&legs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": legs, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsRouteLeg adds a planned/actual leg between two stops.
func CreateLogisticsRouteLeg(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsRouteLeg
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
		input.Status = "PLANNED"
	}
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Assignments ────────────────────────────────────────────────────────────--

// GetLogisticsAssignments lists carrier/fleet assignments for the tenant.
//
//	?shipmentOrderId=  ?carrierId=  ?status=  ?limit=  ?offset=
func GetLogisticsAssignments(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsAssignment{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
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
	var rows []models.LogisticsAssignment
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsAssignment assigns a carrier (or own driver+vehicle) to a
// shipment. shipmentOrderId is required.
func CreateLogisticsAssignment(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsAssignment
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
	if input.AssignmentType == "" {
		input.AssignmentType = "CARRIER"
	}
	if input.Status == "" {
		input.Status = "ASSIGNED"
	}
	if input.Currency == "" {
		input.Currency = "AED"
	}
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Tracking events (generic) ─────────────────────────────────────────────────

// GetLogisticsTrackingEvents lists a shipment's tracking timeline, most recent
// first.
//
//	?shipmentOrderId=  ?eventType=  ?limit=  ?offset=
func GetLogisticsTrackingEvents(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsTrackingEvent{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("eventType")); v != "" {
		q = q.Where("event_type IN ?", splitCSV(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsTrackingEvent
	if err := q.Order("occurred_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsTrackingEvent records a non-GPS timeline event (status change,
// milestone, manual note). GPS pings should go through the ingest endpoint
// (POST /shipments/:id/tracking) so they trigger ETA + geofence recompute;
// this generic create has no side effects. shipmentOrderId and eventType are
// required.
func CreateLogisticsTrackingEvent(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsTrackingEvent
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(input.ShipmentOrderID) == "" || strings.TrimSpace(input.EventType) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shipmentOrderId and eventType are required"})
		return
	}
	input.ID = ""
	input.TenantID = tid
	if input.Source == "" {
		input.Source = "SYSTEM"
	}
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── POD events ────────────────────────────────────────────────────────────────

// GetLogisticsPodEvents lists proof-of-delivery records for the tenant.
func GetLogisticsPodEvents(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsPodEvent{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsPodEvent
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsPodEvent records a proof of delivery (recipient, signature,
// photos, GPS). shipmentOrderId is required. created_by is stamped from the
// token.
func CreateLogisticsPodEvent(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsPodEvent
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
		input.Status = "SUBMITTED"
	}
	if uid := auth.UserID(c); uid != "" {
		input.CreatedBy = &uid
	}
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Telematics events ─────────────────────────────────────────────────────────

// GetLogisticsTelematicsEvents lists the raw device feed for the tenant, most
// recent first.
func GetLogisticsTelematicsEvents(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsTelematicsEvent{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("provider")); v != "" {
		q = q.Where("provider = ?", v)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsTelematicsEvent
	if err := q.Order("event_time DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// CreateLogisticsTelematicsEvent ingests one raw telematics frame.
// shipmentOrderId is required.
func CreateLogisticsTelematicsEvent(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.LogisticsTelematicsEvent
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
	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, input)
}

// ── Exceptions ────────────────────────────────────────────────────────────────

// GetLogisticsExceptions lists shipment exceptions (geofence deviations, SLA
// breaches, …) for the tenant, most recently raised first.
//
//	?shipmentOrderId=  ?status=  ?severity=  ?exceptionType=  ?limit=  ?offset=
func GetLogisticsExceptions(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	limit, offset := pageParams(c, defaultExecutionPageSize, maxExecutionPageSize)

	q := database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentException{})
	if v := strings.TrimSpace(c.Query("shipmentOrderId")); v != "" {
		q = q.Where("shipment_order_id = ?", v)
	}
	if v := strings.TrimSpace(c.Query("status")); v != "" {
		q = q.Where("status IN ?", splitCSV(v))
	}
	if v := strings.TrimSpace(c.Query("severity")); v != "" {
		q = q.Where("severity IN ?", splitCSV(v))
	}
	if v := strings.TrimSpace(c.Query("exceptionType")); v != "" {
		q = q.Where("exception_type IN ?", splitCSV(v))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var rows []models.LogisticsShipmentException
	if err := q.Order("raised_at DESC").Limit(limit).Offset(offset).Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total, "limit": limit, "offset": offset})
}

// ── GPS ingest (the headline) ────────────────────────────────────────────────

// trackingIngestRequest is the POST body for /shipments/:id/tracking. lat/lng
// are required; the rest default (eventType GPS_PING, source gps, occurredAt
// now). tenantId / shipmentOrderId are NEVER taken from the body.
type trackingIngestRequest struct {
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	OccurredAt   *string  `json:"occurredAt"`
	EventType    *string  `json:"eventType"`
	Status       *string  `json:"status"`
	Source       *string  `json:"source"`
	Notes        *string  `json:"notes"`
	AssignmentID *string  `json:"assignmentId"`
}

// IngestLogisticsTracking stores a GPS ping for a shipment and then, both
// best-effort, recomputes the ETA and evaluates geofences. Port of
// src/app/api/logistics/shipments/[id]/tracking/route.ts.
//
// The ETA/geofence steps never fail the ingest: a flaky predictor or a slow
// exception insert can't lose a GPS point. SMS/email sends are deferred (see
// the file header) — the response reports the notify decision and how many
// exception rows were raised, with notificationsDeferred=true.
func IngestLogisticsTracking(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	shipmentID := c.Param("id")

	var req trackingIngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Latitude == nil || req.Longitude == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "latitude and longitude are required"})
		return
	}

	// Verify the shipment exists for this tenant before writing a ping against
	// it. A row in another tenant is a 404 — same probe-resistance as the
	// shipment GET endpoint.
	var ship models.LogisticsShipmentOrder
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", shipmentID).First(&ship).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "shipment not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 1) Store the ping.
	ev := models.LogisticsTrackingEvent{
		TenantID:        tid,
		ShipmentOrderID: shipmentID,
		AssignmentID:    req.AssignmentID,
		EventType:       "GPS_PING",
		Status:          req.Status,
		Latitude:        req.Latitude,
		Longitude:       req.Longitude,
		Source:          "gps",
		Notes:           req.Notes,
	}
	if req.EventType != nil && strings.TrimSpace(*req.EventType) != "" {
		ev.EventType = strings.TrimSpace(*req.EventType)
	}
	if req.Source != nil && strings.TrimSpace(*req.Source) != "" {
		ev.Source = strings.TrimSpace(*req.Source)
	}
	if req.OccurredAt != nil && strings.TrimSpace(*req.OccurredAt) != "" {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(*req.OccurredAt)); err == nil {
			ev.OccurredAt = t // else BeforeCreate defaults to now
		}
	}
	if err := database.DB.Create(&ev).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 2) Recompute ETA (best-effort).
	prediction, decision := recomputeShipmentEta(c, tid, shipmentID, &ship)

	// 3) Evaluate geofences (best-effort).
	events, raised := evaluateShipmentGeofences(c, tid, shipmentID, &ship)

	c.JSON(http.StatusCreated, gin.H{
		"ingested":              true,
		"trackingEventId":       ev.ID,
		"eta":                   prediction,
		"notifyDecision":        decision,
		"notified":              false, // sends deferred to a later increment
		"notifyReason":          decision.Reason,
		"notificationsDeferred": true,
		"geofenceEvents":        events,
		"alertsRaised":          raised,
	})
}

// recomputeShipmentEta loads the shipment's destination + recent pings, runs
// the pure predictor, persists the ETA where the tracking UI reads it (latest
// tracking-event metadata + latest telematics eta_at), and returns the
// prediction plus the notify decision. Port of recomputeShipmentEta in
// eta-notifier.ts. Best-effort: any DB error is swallowed (the ingest already
// succeeded), but the prediction is still returned for the response.
func recomputeShipmentEta(c *gin.Context, tid, shipmentID string, ship *models.LogisticsShipmentOrder) (etapredict.Prediction, etapredict.NotifyDecision) {
	now := time.Now()

	// Destination = coords of the last DELIVERY stop (by sequence_no).
	var destination *geo.LatLng
	var plannedArrival *time.Time
	var destStop models.LogisticsShipmentStop
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("shipment_order_id = ? AND stop_type = ? AND latitude IS NOT NULL AND longitude IS NOT NULL", shipmentID, "DELIVERY").
		Order("sequence_no DESC").First(&destStop).Error; err == nil {
		if destStop.Latitude != nil && destStop.Longitude != nil {
			destination = &geo.LatLng{Latitude: *destStop.Latitude, Longitude: *destStop.Longitude}
		}
		plannedArrival = destStop.PlannedArrivalAt
	}
	if plannedArrival == nil {
		plannedArrival = ship.DeliveryWindowTo
	}

	// Recent GPS pings (most recent first, with coords).
	var pings []models.LogisticsTrackingEvent
	database.DB.Scopes(auth.WithTenant(c)).
		Where("shipment_order_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL", shipmentID).
		Order("occurred_at DESC").Limit(recentPingWindow).Find(&pings)

	points := make([]etapredict.TrackingPoint, 0, len(pings))
	for _, p := range pings {
		if p.Latitude == nil || p.Longitude == nil {
			continue
		}
		points = append(points, etapredict.TrackingPoint{
			LatLng:     geo.LatLng{Latitude: *p.Latitude, Longitude: *p.Longitude},
			OccurredAt: p.OccurredAt,
		})
	}

	prediction := etapredict.PredictEta(etapredict.Input{
		TrackingPoints:      points,
		Destination:         destination,
		Now:                 now,
		PlannedArrivalAt:    plannedArrival,
		LaneAverageSpeedKmh: metaFloatPtr(ship.Metadata, "laneAverageSpeedKmh"),
	})

	// Persist the ETA, both best-effort.
	// (a) latest tracking-event metadata — audit + secondary readers.
	if prediction.EtaAt != nil && len(pings) > 0 {
		latest := &pings[0]
		if latest.Metadata == nil {
			latest.Metadata = map[string]any{}
		}
		latest.Metadata["etaAt"] = prediction.EtaAt.UTC().Format(time.RFC3339)
		latest.Metadata["etaMethod"] = string(prediction.Method)
		latest.Metadata["etaConfidence"] = string(prediction.Confidence)
		database.DB.Scopes(auth.WithTenant(c)).Model(latest).Select("metadata").Updates(latest)
	}
	// (b) latest telematics eta_at/eta_confidence — what the customer-tracking
	//     view actually reads. Map the confidence enum onto a 0–1 score.
	if prediction.EtaAt != nil {
		confScore := 0.3
		switch prediction.Confidence {
		case etapredict.ConfidenceHigh:
			confScore = 0.9
		case etapredict.ConfidenceMedium:
			confScore = 0.6
		}
		var latestTel models.LogisticsTelematicsEvent
		if err := database.DB.Scopes(auth.WithTenant(c)).
			Where("shipment_order_id = ?", shipmentID).
			Order("event_time DESC").First(&latestTel).Error; err == nil {
			latestTel.EtaAt = prediction.EtaAt
			latestTel.EtaConfidence = &confScore
			database.DB.Scopes(auth.WithTenant(c)).Model(&latestTel).
				Select("eta_at", "eta_confidence").Updates(&latestTel)
		}
	}

	// Decide (but don't send — deferred). lastNotifiedEtaAt comes from shipment
	// metadata; since we don't send, we don't update it either, so the decision
	// reflects what a notifier WOULD do.
	decision := etapredict.DecideNotify(prediction, metaTimePtr(ship.Metadata, "lastNotifiedEtaAt"), 0)
	return prediction, decision
}

// evaluateShipmentGeofences loads the shipment's stop fences + route corridor +
// last two pings, evaluates the transition, and raises a (de-duped) exception
// row per event. Port of evaluateShipmentGeofences in geofence-service.ts.
// Best-effort: returns the events it detected and how many exception rows it
// raised; DB errors are swallowed.
func evaluateShipmentGeofences(c *gin.Context, tid, shipmentID string, ship *models.LogisticsShipmentOrder) ([]geofence.Event, int) {
	// Stops with coordinates → circle fences, ordered by sequence_no.
	var stops []models.LogisticsShipmentStop
	database.DB.Scopes(auth.WithTenant(c)).
		Where("shipment_order_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL", shipmentID).
		Order("sequence_no ASC").Find(&stops)

	circles := make([]geofence.CircleFence, 0, len(stops))
	for i := range stops {
		s := &stops[i]
		if s.Latitude == nil || s.Longitude == nil {
			continue
		}
		radiusM := defaultStopRadiusM
		if s.GeofenceRadiusM != nil {
			radiusM = float64(*s.GeofenceRadiusM)
		}
		circles = append(circles, geofence.CircleFence{
			ID:      s.ID,
			Kind:    stopFenceKind(s.StopType),
			Center:  geo.LatLng{Latitude: *s.Latitude, Longitude: *s.Longitude},
			RadiusM: radiusM,
			Label:   s.LocationName,
		})
	}

	// Corridor: a real route polyline (tight) if present on metadata, else the
	// straight line through the stop centres (generous).
	var corridor *geofence.CorridorFence
	if poly := parseRoutePolyline(ship.Metadata); len(poly) >= 2 {
		corridor = &geofence.CorridorFence{Polyline: poly, WidthM: routePolylineCorridorWidthM}
	} else if len(circles) >= 2 {
		centers := make([]geo.LatLng, len(circles))
		for i, cf := range circles {
			centers[i] = cf.Center
		}
		corridor = &geofence.CorridorFence{Polyline: centers, WidthM: straightLineCorridorWidthM}
	}

	// Last two pings: [0]=curr (just ingested), [1]=prev.
	var pings []models.LogisticsTrackingEvent
	database.DB.Scopes(auth.WithTenant(c)).
		Where("shipment_order_id = ? AND latitude IS NOT NULL AND longitude IS NOT NULL", shipmentID).
		Order("occurred_at DESC").Limit(2).Find(&pings)
	if len(pings) == 0 || pings[0].Latitude == nil || pings[0].Longitude == nil {
		return nil, 0
	}
	curr := geo.LatLng{Latitude: *pings[0].Latitude, Longitude: *pings[0].Longitude}
	var prev *geo.LatLng
	if len(pings) > 1 && pings[1].Latitude != nil && pings[1].Longitude != nil {
		prev = &geo.LatLng{Latitude: *pings[1].Latitude, Longitude: *pings[1].Longitude}
	}

	events := geofence.EvaluateGeofences(geofence.EvaluateInput{
		Curr: curr, Prev: prev, Circles: circles, Corridor: corridor,
	})
	if len(events) == 0 {
		return nil, 0
	}

	shipmentNo := ship.ShipmentNo
	if shipmentNo == "" && len(shipmentID) >= 8 {
		shipmentNo = shipmentID[:8]
	}

	raised := 0
	cutoff := time.Now().Add(-time.Duration(geofenceDedupWindowMinutes) * time.Minute)
	for _, e := range events {
		exType := geofence.EventTypeCode(e)

		// De-dup: skip if an OPEN exception of this type was raised recently.
		var recent int64
		database.DB.Scopes(auth.WithTenant(c)).Model(&models.LogisticsShipmentException{}).
			Where("shipment_order_id = ? AND exception_type = ? AND status = ? AND raised_at > ?",
				shipmentID, exType, "OPEN", cutoff).
			Count(&recent)
		if recent > 0 {
			continue
		}

		title := geofence.EventTitle(e, shipmentNo)
		ex := models.LogisticsShipmentException{
			TenantID:        tid,
			ShipmentOrderID: shipmentID,
			ExceptionType:   exType,
			Severity:        geofence.EventSeverity(e),
			Status:          "OPEN",
			Title:           title,
			Description:     &title,
			Metadata:        map[string]any{"geofence": e},
		}
		if err := database.DB.Create(&ex).Error; err == nil {
			raised++
		}
		// Note: SMS/email on DEVIATION is deferred (no sender port yet).
	}
	return events, raised
}

// ── small helpers ─────────────────────────────────────────────────────────────

// stopFenceKind maps a stop_type onto the geofence circle kind.
func stopFenceKind(stopType string) geofence.StopFenceKind {
	switch strings.ToUpper(strings.TrimSpace(stopType)) {
	case "PICKUP":
		return geofence.FencePickup
	case "DELIVERY":
		return geofence.FenceDelivery
	default:
		return geofence.FenceStop
	}
}

// metaFloatPtr reads a numeric value out of a JSONB metadata map, tolerating
// the several shapes a JSON number can take after round-tripping (float64 from
// encoding/json, json.Number, or a stringified number as the Next.js side
// sometimes stores). Returns nil when absent or unparseable.
func metaFloatPtr(m map[string]any, key string) *float64 {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch n := v.(type) {
	case float64:
		return &n
	case float32:
		f := float64(n)
		return &f
	case int:
		f := float64(n)
		return &f
	case int64:
		f := float64(n)
		return &f
	case json.Number:
		if f, err := n.Float64(); err == nil {
			return &f
		}
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(n), 64); err == nil {
			return &f
		}
	}
	return nil
}

// metaTimePtr reads an ISO-8601 timestamp string out of a metadata map.
func metaTimePtr(m map[string]any, key string) *time.Time {
	if m == nil {
		return nil
	}
	v, ok := m[key]
	if !ok {
		return nil
	}
	s, ok := v.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return nil
	}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(s)); err == nil {
		return &t
	}
	return nil
}

// parseRoutePolyline pulls metadata.routePolyline ([{latitude,longitude}, …])
// into a slice of geo.LatLng, skipping malformed points. Returns nil when the
// key is absent or not an array.
func parseRoutePolyline(m map[string]any) []geo.LatLng {
	if m == nil {
		return nil
	}
	raw, ok := m["routePolyline"]
	if !ok {
		return nil
	}
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]geo.LatLng, 0, len(arr))
	for _, it := range arr {
		pt, ok := it.(map[string]any)
		if !ok {
			continue
		}
		lat := metaFloatPtr(pt, "latitude")
		lng := metaFloatPtr(pt, "longitude")
		if lat == nil || lng == nil {
			continue
		}
		out = append(out, geo.LatLng{Latitude: *lat, Longitude: *lng})
	}
	return out
}

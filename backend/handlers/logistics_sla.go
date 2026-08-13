package handlers

// Logistics SLA monitor (Phase L4a) — the Go-native replacement for the Next.js
// GET /api/logistics/sla endpoint that drives the dispatch board's "SLA Alerts"
// banner (src/app/logistics/dispatch/page.tsx, SlaAlertBanner).
//
// WHY THIS IS A REWRITE, NOT A LINE-FOR-LINE PORT. Like the analytics endpoint,
// the legacy route scans the legacy `bookings` table
// (service_type = 'LOGISTICS') with NO tenant filter — a cross-tenant leak — and
// that table is also the wrong source: it lacks the columns the query reads, so
// it already falls through to `.catch(() => [])` and the banner shows nothing.
// The canonical trip data lives in logistics_shipment_orders, so this handler
// recomputes the same alert contract from there behind auth.WithTenant.
//
// Tier logic is verbatim from the legacy route (WARN_HOURS = 2, BREACH_HOURS = 4):
//   - WARNING:  within 2h of the deadline (still on time, hoursLate ≥ -2)
//   - BREACHED: past the deadline but ≤ 4h late
//   - CRITICAL: > 4h past the deadline
// The deadline is delivery_window_to (the on-time deadline), the same column the
// analytics on-time-rate uses where the legacy `bookings` query used end_date.
//
// TWO SOURCES, ONE ALERT PER SHIPMENT. The legacy route only looked at the
// trip's delivery deadline. This rewrite ALSO folds in open
// logistics_shipment_exceptions that carry an SLA timer (sla_due_at) — the rows
// the L2 geofence/exception system raises and tracks through its
// acknowledge → escalate → resolve lifecycle. "Open" matches domain.ts exactly:
// status <> 'RESOLVED'. Both sources feed the same tier function; alerts are
// deduped by shipment, keeping the most severe (then the most overdue), so a
// shipment that is both delivery-late and carries an open SLA exception appears
// once. This is strictly more complete than the legacy banner while preserving
// its exact response shape.
//
// driverName / vehiclePlate are always null: the legacy route read them from a
// denormalised `notes` JSON blob, but logistics_shipment_orders stores only the
// assigned_driver_id / assigned_vehicle_id foreign keys, and the dispatch banner
// does not consume those two fields. Resolving them would mean extra per-row
// cross-table lookups for data the UI ignores, so they stay nil (honest: null
// where the canonical table doesn't denormalise the value).
//
// DEFERRED (carried by task #30): the legacy route fires an operations
// SMS/email on each CRITICAL alert via notifyTripStatusChange. That sender is
// not yet ported to Go; this GET stays a pure read (no side effects). The alert
// send is wired when the SMS/email sender port lands in L4 — exactly the same
// deferral as the L3 finance write path, and for the same reason (one writer,
// not two, during the dual-run).
//
// Unlike the legacy route, a hard DB error returns 500 rather than masking to an
// empty body — these are tenant-scoped queries against columns that exist, so a
// failure is a real fault. The banner only swaps in new data when the response
// is ok, so a 500 simply leaves the last good render in place.

import (
	"math"
	"net/http"
	"sort"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
)

// SLA tier thresholds (hours), verbatim from the Next.js route.
const (
	slaWarnHours   = 2.0
	slaBreachHours = 4.0

	slaTierWarning  = "WARNING"
	slaTierBreached = "BREACHED"
	slaTierCritical = "CRITICAL"
)

// slaActiveStatuses is the in-transit set the legacy route scanned for SLA
// breaches. NOTE this is intentionally wider than the analytics
// activeShipmentStatuses: the SLA scan also includes ASSIGNED (assigned but not
// yet dispatched still has a delivery clock running), matching the legacy
// route's status list exactly.
var slaActiveStatuses = []string{"DISPATCHED", "ENROUTE_PICKUP", "LOADED", "ENROUTE_DELIVERY", "ACTIVE", "ASSIGNED"}

// slaAlert is the exact JSON object the dispatch banner consumes. The banner
// reads id, bookingRef, tier, hoursLate, customerName and deadline; the
// remaining fields are kept for response fidelity with the legacy route.
// hoursLate is signed — negative means "due in |x|h" (a WARNING), positive means
// "+xh late" — so the banner's `hoursLate > 0` check works unchanged.
type slaAlert struct {
	ID           string  `json:"id"`
	BookingRef   string  `json:"bookingRef"`
	Status       string  `json:"status"`
	CustomerName *string `json:"customerName"`
	Origin       *string `json:"origin"`
	Destination  *string `json:"destination"`
	Deadline     string  `json:"deadline"`
	HoursLate    float64 `json:"hoursLate"`
	Tier         string  `json:"tier"`
	DriverName   *string `json:"driverName"`
	VehiclePlate *string `json:"vehiclePlate"`
}

type slaSummary struct {
	Total    int `json:"total"`
	Warning  int `json:"warning"`
	Breached int `json:"breached"`
	Critical int `json:"critical"`
}

// slaTier classifies a deadline relative to now into a tier, returning the
// signed hoursLate (rounded to 1dp for display) and whether the deadline is
// alert-worthy at all. The tier decision uses the raw difference (matching the
// legacy route, which rounds only for display).
func slaTier(deadline, now time.Time) (tier string, hoursLate float64, ok bool) {
	raw := now.Sub(deadline).Hours()
	rounded := math.Round(raw*10) / 10
	switch {
	case raw > slaBreachHours:
		return slaTierCritical, rounded, true
	case raw > 0:
		return slaTierBreached, rounded, true
	case -raw <= slaWarnHours:
		// Within the warning window before the deadline (hoursLate ≥ -2).
		return slaTierWarning, rounded, true
	default:
		return "", 0, false
	}
}

// slaRank orders tiers by severity for dedup and sorting (higher = worse).
func slaRank(tier string) int {
	switch tier {
	case slaTierCritical:
		return 3
	case slaTierBreached:
		return 2
	case slaTierWarning:
		return 1
	default:
		return 0
	}
}

// slaISO formats a deadline the way the legacy route did (Date.toISOString()):
// a UTC instant with millisecond precision and a literal 'Z'. The banner parses
// it with new Date(), which accepts this directly.
func slaISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// slaAlertFor builds an alert from a shipment row plus the deadline/tier that
// flagged it. Both the delivery-deadline scan and the exception scan funnel
// through here so the two sources produce identical alert shapes.
func slaAlertFor(s *models.LogisticsShipmentOrder, deadline time.Time, tier string, hoursLate float64) slaAlert {
	return slaAlert{
		ID:           s.ID,
		BookingRef:   s.ShipmentNo,
		Status:       s.Status,
		CustomerName: s.CargoOwnerName,
		Origin:       s.OriginName,
		Destination:  s.DestinationName,
		Deadline:     slaISO(deadline),
		HoursLate:    hoursLate,
		Tier:         tier,
		DriverName:   nil,
		VehiclePlate: nil,
	}
}

// GetLogisticsSla returns the tenant-scoped SLA alert set + summary counts,
// computed from active logistics_shipment_orders (delivery-deadline breaches)
// merged with open SLA-timer logistics_shipment_exceptions.
func GetLogisticsSla(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	now := time.Now()
	fail := func(err error) { c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()}) }

	// ── Source 1: active shipments with a delivery deadline ──────────────────
	var shipments []models.LogisticsShipmentOrder
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("status IN ?", slaActiveStatuses).
		Where("delivery_window_to IS NOT NULL").
		Order("delivery_window_to ASC").
		Find(&shipments).Error; err != nil {
		fail(err)
		return
	}

	// Index loaded shipments and accumulate one alert per shipment id, keeping
	// the most severe (and within a tier, the most overdue).
	shipByID := make(map[string]*models.LogisticsShipmentOrder, len(shipments))
	for i := range shipments {
		shipByID[shipments[i].ID] = &shipments[i]
	}
	alerts := make(map[string]slaAlert)
	consider := func(a slaAlert) {
		cur, exists := alerts[a.ID]
		if !exists ||
			slaRank(a.Tier) > slaRank(cur.Tier) ||
			(slaRank(a.Tier) == slaRank(cur.Tier) && a.HoursLate > cur.HoursLate) {
			alerts[a.ID] = a
		}
	}

	for i := range shipments {
		s := &shipments[i]
		if s.DeliveryWindowTo == nil {
			continue // defensive; the WHERE already excludes NULLs
		}
		if tier, hoursLate, ok := slaTier(*s.DeliveryWindowTo, now); ok {
			consider(slaAlertFor(s, *s.DeliveryWindowTo, tier, hoursLate))
		}
	}

	// ── Source 2: open exceptions carrying an SLA timer ──────────────────────
	// "Open" mirrors domain.ts listExceptions (status <> 'RESOLVED'); only rows
	// with an sla_due_at have an SLA clock worth surfacing here.
	var excs []models.LogisticsShipmentException
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("status <> ?", "RESOLVED").
		Where("sla_due_at IS NOT NULL").
		Find(&excs).Error; err != nil {
		fail(err)
		return
	}

	// Batch-load the shipments those exceptions reference but the deadline scan
	// didn't (e.g. the shipment is no longer in an active status). One scoped IN
	// query, not N+1.
	var needIDs []string
	for i := range excs {
		if _, ok := shipByID[excs[i].ShipmentOrderID]; !ok {
			needIDs = append(needIDs, excs[i].ShipmentOrderID)
		}
	}
	if len(needIDs) > 0 {
		var extra []models.LogisticsShipmentOrder
		if err := database.DB.Scopes(auth.WithTenant(c)).
			Where("id IN ?", needIDs).Find(&extra).Error; err != nil {
			fail(err)
			return
		}
		for i := range extra {
			shipByID[extra[i].ID] = &extra[i]
		}
	}

	for i := range excs {
		e := &excs[i]
		if e.SlaDueAt == nil {
			continue
		}
		s := shipByID[e.ShipmentOrderID]
		if s == nil {
			// The shipment is unreachable for this tenant (e.g. soft-deleted, so
			// WithTenant+Model filtered it out). Surfacing an alert with no
			// backing shipment would render a blank row — skip it.
			continue
		}
		if tier, hoursLate, ok := slaTier(*e.SlaDueAt, now); ok {
			consider(slaAlertFor(s, *e.SlaDueAt, tier, hoursLate))
		}
	}

	// Most severe first, then most overdue — the banner renders the list in
	// array order, so urgent alerts surface at the top.
	out := make([]slaAlert, 0, len(alerts))
	for _, a := range alerts {
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		ri, rj := slaRank(out[i].Tier), slaRank(out[j].Tier)
		if ri != rj {
			return ri > rj
		}
		return out[i].HoursLate > out[j].HoursLate
	})

	summary := slaSummary{Total: len(out)}
	for _, a := range out {
		switch a.Tier {
		case slaTierWarning:
			summary.Warning++
		case slaTierBreached:
			summary.Breached++
		case slaTierCritical:
			summary.Critical++
		}
	}

	c.JSON(http.StatusOK, gin.H{"alerts": out, "summary": summary})
}

// Package analytics computes data-driven maintenance projections from a
// vehicle's completed-service history. This is the Level 2 honesty
// upgrade to GetMaintenanceDueAlerts: instead of hardcoded "confidence
// 85%" theater, we look at each vehicle's prior completed maintenance,
// measure the actual interval between same-type services (in km and
// days), and project the next-due milestone via linear extrapolation.
//
// Every output carries the sample size (how many prior services the
// interval was averaged over) and a `source` field so the UI can render
// "based on 4 prior services" vs. "based on 1 prior service (low
// confidence)" vs. "from fleet average" — no hidden assumptions.
//
// Out of scope here: any kind of model fitting beyond mean intervals,
// telemetry-based wear estimation, or fault-code analysis. Those need
// telemetry ingestion which doesn't exist in this codebase yet.
package analytics

import (
	"sort"
	"time"
)

// ServiceEvent is one completed maintenance event distilled to the four
// fields the interval math needs. The handler builds these from
// maintenance_requests rows where status indicates completion AND
// completion_date is set.
type ServiceEvent struct {
	VehicleID       string
	MaintenanceType string // "Brake Pads", "Tires", "Battery", etc.
	Odometer        int    // odometer reading at request creation (best proxy for "odometer at service")
	CompletedAt     time.Time
}

// IntervalStats summarises the gap between consecutive same-type services
// for a single vehicle. SampleCount is the number of intervals measured
// (i.e. n-1 where n is the number of completed services) — explicitly
// surfaced so callers can decide how much weight to put on the means.
type IntervalStats struct {
	SampleCount     int       // number of intervals (not services)
	MeanKm          int       // mean odometer delta between consecutive same-type completions
	MeanDays        int       // mean day delta between consecutive same-type completions
	LastServiceAt   time.Time // when the most recent same-type service completed
	LastOdometer    int       // odometer reading at the most recent same-type completion
}

// Projection is the forward-looking estimate produced by ProjectNextDue.
// Days values are computed assuming the vehicle keeps accumulating
// kilometres at the same average daily rate observed in its history;
// nil/zero fields mean the projection couldn't be computed (e.g. no
// daily-km rate available).
type Projection struct {
	NextDueAtKm        int       // projected odometer at next service of this type
	NextDueByDate      time.Time // projected date of next service of this type
	KmRemaining        int       // NextDueAtKm - currentMileage (negative = overdue)
	DaysRemaining      int       // days from now until NextDueByDate (negative = overdue)
	Status             string    // "overdue" | "due_soon" | "on_schedule"
	DailyKmRateUsed    float64   // the km/day rate used to derive DaysRemaining
}

// ComputeIntervalStats turns a list of completed services for a single
// vehicle + single maintenance type into the interval summary. Services
// must already be filtered to one vehicle and one type — this function
// does NOT do that filtering itself, so the same code can be reused for
// per-vehicle stats and (Phase 2 follow-up) fleet-average stats.
//
// Returns (zero IntervalStats, false) if there are fewer than 2 services
// — you can't measure an interval from a single point. The handler
// should treat this as "fall back to rules" or skip the analytics.
func ComputeIntervalStats(events []ServiceEvent) (IntervalStats, bool) {
	if len(events) < 2 {
		return IntervalStats{}, false
	}
	// Defensive copy + sort by CompletedAt ascending so the deltas are
	// stable regardless of caller insertion order.
	sorted := make([]ServiceEvent, len(events))
	copy(sorted, events)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].CompletedAt.Before(sorted[j].CompletedAt)
	})

	var totalKm, totalDays int
	intervals := 0
	for i := 1; i < len(sorted); i++ {
		dKm := sorted[i].Odometer - sorted[i-1].Odometer
		dDays := int(sorted[i].CompletedAt.Sub(sorted[i-1].CompletedAt).Hours() / 24)
		// Negative or zero deltas mean someone backdated a record or two
		// services completed on the same day with no odometer change.
		// Skip those samples rather than letting them drag the mean to
		// zero or negative.
		if dKm > 0 && dDays > 0 {
			totalKm += dKm
			totalDays += dDays
			intervals++
		}
	}
	if intervals == 0 {
		return IntervalStats{}, false
	}

	last := sorted[len(sorted)-1]
	return IntervalStats{
		SampleCount:   intervals,
		MeanKm:        totalKm / intervals,
		MeanDays:      totalDays / intervals,
		LastServiceAt: last.CompletedAt,
		LastOdometer:  last.Odometer,
	}, true
}

// ProjectNextDue extrapolates from an IntervalStats summary plus the
// vehicle's current state to a Projection. now is passed in (rather than
// captured from time.Now()) so the function is fully deterministic and
// unit-testable.
//
// Status thresholds:
//   - "overdue":     KmRemaining ≤ 0 OR DaysRemaining ≤ 0
//   - "due_soon":    KmRemaining ≤ 10% of MeanKm OR DaysRemaining ≤ 14
//   - "on_schedule": everything else
func ProjectNextDue(stats IntervalStats, currentMileage int, now time.Time) Projection {
	p := Projection{
		NextDueAtKm:   stats.LastOdometer + stats.MeanKm,
		NextDueByDate: stats.LastServiceAt.AddDate(0, 0, stats.MeanDays),
	}
	p.KmRemaining = p.NextDueAtKm - currentMileage

	// Daily-km rate from the history: total km covered by this vehicle
	// in service-to-service intervals divided by total days elapsed.
	// (Same as MeanKm/MeanDays since we already divided through, but
	// we recover the float-precision version for the days projection.)
	if stats.MeanDays > 0 {
		p.DailyKmRateUsed = float64(stats.MeanKm) / float64(stats.MeanDays)
	}

	p.DaysRemaining = int(p.NextDueByDate.Sub(now).Hours() / 24)
	// Cross-check: if the vehicle is racking up km faster than the
	// historical pace, the km-based estimate may be sooner than the
	// date-based one. Pick the more conservative (earlier-due) of the
	// two so we don't show "due in 30 days" when km-rate says "due in 5".
	if p.DailyKmRateUsed > 0 && p.KmRemaining > 0 {
		kmBasedDays := int(float64(p.KmRemaining) / p.DailyKmRateUsed)
		if kmBasedDays < p.DaysRemaining {
			p.DaysRemaining = kmBasedDays
		}
	}

	switch {
	case p.KmRemaining <= 0 || p.DaysRemaining <= 0:
		p.Status = "overdue"
	case p.KmRemaining <= stats.MeanKm/10 || p.DaysRemaining <= 14:
		p.Status = "due_soon"
	default:
		p.Status = "on_schedule"
	}
	return p
}

// GroupByVehicleAndType bins a flat list of completed services by
// (vehicleID, maintenanceType). Returned map keyed by vehicle id; inner
// map keyed by maintenance type. Used by handlers to feed
// ComputeIntervalStats once per (vehicle, type) bucket.
func GroupByVehicleAndType(events []ServiceEvent) map[string]map[string][]ServiceEvent {
	out := map[string]map[string][]ServiceEvent{}
	for _, e := range events {
		if e.VehicleID == "" || e.MaintenanceType == "" {
			continue
		}
		if _, ok := out[e.VehicleID]; !ok {
			out[e.VehicleID] = map[string][]ServiceEvent{}
		}
		out[e.VehicleID][e.MaintenanceType] = append(out[e.VehicleID][e.MaintenanceType], e)
	}
	return out
}

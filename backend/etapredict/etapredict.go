// Package etapredict is the Go port of src/lib/logistics/eta-predictor.ts.
//
// It continuously estimates a shipment's arrival time from its GPS tracking
// history. v1 is observed-speed extrapolation, not a trained model:
//
//	effective speed = distance travelled across recent pings / time elapsed
//	remaining time  = remaining road distance / effective speed
//	ETA             = now + remaining time
//
// When GPS is thin or the truck is stopped it walks a fallback ladder:
//
//	observed-speed → lane historical average → configured default speed →
//	planned arrival time
//
// Every prediction reports which method it used and a confidence level, so the
// UI and notifier can treat a low-confidence ETA differently from a high one.
//
// Pure package: no DB, no network. The handler loads tracking history and
// persists the result. Keeping the math pure makes the edge cases (stopped
// truck, GPS jitter, out-of-order pings, already-arrived) unit-testable
// without a database.
//
// Difference from the TS: timestamps are time.Time rather than ISO strings —
// idiomatic Go, and the handler already has time.Time from the DB rows.
package etapredict

import (
	"fmt"
	"math"
	"sort"
	"time"

	"fleet360-backend/geo"
)

// ── Inputs ───────────────────────────────────────────────────────────────────

// TrackingPoint is one GPS ping. Embeds geo.LatLng so HaversineKm can take it
// directly and callers can write tp.Latitude / tp.Longitude.
type TrackingPoint struct {
	geo.LatLng
	OccurredAt time.Time
}

// Input is everything PredictEta needs. Pointers are "absent" when nil, mirroring
// the TS null fields.
type Input struct {
	// TrackingPoints are recent GPS pings. Order doesn't matter — sorted by OccurredAt.
	TrackingPoints []TrackingPoint
	// Destination is where the shipment is going. Nil when we have no coordinates.
	Destination *geo.LatLng
	// Now is the reference instant — passed in for deterministic testing.
	Now time.Time
	// PlannedArrivalAt is the delivery-window arrival — the ultimate fallback.
	PlannedArrivalAt *time.Time
	// LaneAverageSpeedKmh is the historical lane speed (fallback when GPS is thin).
	LaneAverageSpeedKmh *float64
	// Config overrides the defaults. Nil → all defaults.
	Config *Config
}

// Config mirrors EtaConfig. NOTE: a zero field means "use the default" (same
// effect as omitting the key in the TS spread), so callers wanting a non-default
// value must set it explicitly and cannot set a field to 0.
type Config struct {
	DetourFactor         float64 // crow-flies → road multiplier (GCC default 1.3)
	DefaultSpeedKmh      float64 // used with no observed speed and no lane average
	StoppedSpeedFloorKmh float64 // below this the truck is "stopped", don't extrapolate
	MaxPlausibleSpeedKmh float64 // above this an observed speed is a GPS jump, rejected
	ArrivalRadiusKm      float64 // within this of destination → "arrived"
	MinSpeedWindowSec    float64 // min seconds between window endpoints for a speed reading
	SpeedWindowPoints    int     // how many of the most-recent pings to use
}

// DefaultConfig mirrors the TS DEFAULTS.
func DefaultConfig() Config {
	return Config{
		DetourFactor:         1.3,
		DefaultSpeedKmh:      60,
		StoppedSpeedFloorKmh: 5,
		MaxPlausibleSpeedKmh: 140,
		ArrivalRadiusKm:      0.5,
		MinSpeedWindowSec:    60,
		SpeedWindowPoints:    5,
	}
}

func withDefaults(c *Config) Config {
	cfg := DefaultConfig()
	if c == nil {
		return cfg
	}
	if c.DetourFactor != 0 {
		cfg.DetourFactor = c.DetourFactor
	}
	if c.DefaultSpeedKmh != 0 {
		cfg.DefaultSpeedKmh = c.DefaultSpeedKmh
	}
	if c.StoppedSpeedFloorKmh != 0 {
		cfg.StoppedSpeedFloorKmh = c.StoppedSpeedFloorKmh
	}
	if c.MaxPlausibleSpeedKmh != 0 {
		cfg.MaxPlausibleSpeedKmh = c.MaxPlausibleSpeedKmh
	}
	if c.ArrivalRadiusKm != 0 {
		cfg.ArrivalRadiusKm = c.ArrivalRadiusKm
	}
	if c.MinSpeedWindowSec != 0 {
		cfg.MinSpeedWindowSec = c.MinSpeedWindowSec
	}
	if c.SpeedWindowPoints != 0 {
		cfg.SpeedWindowPoints = c.SpeedWindowPoints
	}
	return cfg
}

// ── Output ───────────────────────────────────────────────────────────────────

// Method is which rung of the fallback ladder produced the ETA.
type Method string

const (
	MethodObservedSpeed Method = "observed-speed" // extrapolated from actual movement
	MethodLaneAverage   Method = "lane-average"   // stopped / thin GPS → historical lane speed
	MethodDefaultSpeed  Method = "default-speed"  // no lane history → configured default
	MethodPlanned       Method = "planned"        // no usable GPS/destination → the plan
	MethodArrived       Method = "arrived"        // already within the arrival radius
)

// Confidence ranks how much to trust the ETA.
type Confidence string

const (
	ConfidenceHigh   Confidence = "high"
	ConfidenceMedium Confidence = "medium"
	ConfidenceLow    Confidence = "low"
)

// Prediction is the result. EtaAt is nil when we couldn't estimate at all.
type Prediction struct {
	EtaAt             *time.Time `json:"etaAt"`
	Method            Method     `json:"method"`
	Confidence        Confidence `json:"confidence"`
	RemainingKm       *float64   `json:"remainingKm"`
	EffectiveSpeedKmh *float64   `json:"effectiveSpeedKmh"`
	Reason            string     `json:"reason"`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func round2(n float64) float64 { return math.Round(n*100) / 100 }

// sortedByTime returns a copy sorted ascending by OccurredAt.
func sortedByTime(points []TrackingPoint) []TrackingPoint {
	out := make([]TrackingPoint, len(points))
	copy(out, points)
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].OccurredAt.Before(out[j].OccurredAt)
	})
	return out
}

func latestPoint(points []TrackingPoint) *TrackingPoint {
	if len(points) == 0 {
		return nil
	}
	sorted := sortedByTime(points)
	return &sorted[len(sorted)-1]
}

// ObservedSpeedKmh is the speed (km/h) across the most recent window of pings,
// or nil when there aren't enough points or the window is too short in time.
//
// Sums leg-by-leg distance (not just first→last) so a truck curving along a
// road isn't under-counted, then divides by total elapsed time.
func ObservedSpeedKmh(points []TrackingPoint, cfg Config) *float64 {
	if len(points) < 2 {
		return nil
	}
	sorted := sortedByTime(points)
	window := sorted
	if len(sorted) > cfg.SpeedWindowPoints {
		window = sorted[len(sorted)-cfg.SpeedWindowPoints:]
	}
	if len(window) < 2 {
		return nil
	}

	distKm := 0.0
	for i := 1; i < len(window); i++ {
		distKm += geo.HaversineKm(window[i-1].LatLng, window[i].LatLng)
	}
	elapsedSec := window[len(window)-1].OccurredAt.Sub(window[0].OccurredAt).Seconds()
	if elapsedSec < cfg.MinSpeedWindowSec {
		return nil
	}

	speed := distKm / (elapsedSec / 3600)
	if math.IsInf(speed, 0) || math.IsNaN(speed) || speed < 0 {
		return nil
	}
	return &speed
}

// ── Main entry point ─────────────────────────────────────────────────────────

// PredictEta estimates the arrival time for a shipment from its tracking history.
func PredictEta(in Input) Prediction {
	cfg := withDefaults(in.Config)

	planned := func(reason string) Prediction {
		return Prediction{
			EtaAt:      in.PlannedArrivalAt,
			Method:     MethodPlanned,
			Confidence: ConfidenceLow,
			Reason:     reason,
		}
	}

	// No destination coordinates → nothing to extrapolate toward.
	if in.Destination == nil {
		return planned("No destination coordinates; using planned arrival.")
	}

	// (TS filters points lacking coordinates here; in Go lat/lng are always
	// present because the handler only builds points from rows that have them.)
	current := latestPoint(in.TrackingPoints)
	if current == nil {
		return planned("No GPS pings with coordinates; using planned arrival.")
	}

	// Remaining road distance ≈ crow-flies × detour factor.
	crowKm := geo.HaversineKm(current.LatLng, *in.Destination)
	remainingKm := round2(crowKm * cfg.DetourFactor)

	// Already there?
	if crowKm <= cfg.ArrivalRadiusKm {
		now := in.Now
		rk := remainingKm
		return Prediction{
			EtaAt:       &now,
			Method:      MethodArrived,
			Confidence:  ConfidenceHigh,
			RemainingKm: &rk,
			Reason:      fmt.Sprintf("Within %gkm of destination — treated as arrived.", cfg.ArrivalRadiusKm),
		}
	}

	// Pick an effective speed via the fallback ladder.
	observed := ObservedSpeedKmh(in.TrackingPoints, cfg)
	var (
		speed      float64
		method     Method
		confidence Confidence
		reason     string
	)

	switch {
	case observed != nil && *observed >= cfg.StoppedSpeedFloorKmh && *observed <= cfg.MaxPlausibleSpeedKmh:
		speed = *observed
		method = MethodObservedSpeed
		confidence = ConfidenceHigh
		reason = fmt.Sprintf("Observed %gkm/h from recent pings.", round2(*observed))
	case in.LaneAverageSpeedKmh != nil && *in.LaneAverageSpeedKmh > 0:
		speed = *in.LaneAverageSpeedKmh
		method = MethodLaneAverage
		confidence = ConfidenceMedium
		if observed != nil && *observed < cfg.StoppedSpeedFloorKmh {
			reason = fmt.Sprintf("Truck appears stopped (%gkm/h); using lane average %gkm/h.", round2(*observed), *in.LaneAverageSpeedKmh)
		} else {
			reason = fmt.Sprintf("Insufficient/implausible GPS speed; using lane average %gkm/h.", *in.LaneAverageSpeedKmh)
		}
	default:
		speed = cfg.DefaultSpeedKmh
		method = MethodDefaultSpeed
		confidence = ConfidenceLow
		reason = fmt.Sprintf("No observed speed or lane average; using default %gkm/h.", cfg.DefaultSpeedKmh)
	}

	remainingHours := remainingKm / speed
	eta := in.Now.Add(time.Duration(remainingHours * float64(time.Hour)))
	rk := remainingKm
	sp := round2(speed)

	return Prediction{
		EtaAt:             &eta,
		Method:            method,
		Confidence:        confidence,
		RemainingKm:       &rk,
		EffectiveSpeedKmh: &sp,
		Reason:            reason,
	}
}

// EtaDeltaMinutes is the whole-minute difference b − a, or nil if either is nil.
// Used by the notifier to decide whether an ETA shift is "material".
func EtaDeltaMinutes(a, b *time.Time) *int {
	if a == nil || b == nil {
		return nil
	}
	mins := int(math.Round(b.Sub(*a).Minutes()))
	return &mins
}

// ── Notify decision ───────────────────────────────────────────────────────────

// NotifyDecision is the output of DecideNotify: whether to proactively message
// the customer about a fresh ETA, and why. DeltaMinutes is the shift (minutes)
// vs. the last-notified ETA — nil when there's no prior ETA or no delta could
// be computed.
type NotifyDecision struct {
	Notify       bool   `json:"notify"`
	Reason       string `json:"reason"`
	DeltaMinutes *int   `json:"deltaMinutes"`
}

// DefaultNotifyThresholdMinutes is the ETA shift (minutes) that counts as
// "material" enough to re-notify when no explicit threshold is supplied.
const DefaultNotifyThresholdMinutes = 15

// DecideNotify decides whether to proactively message the customer about this
// prediction. Port of decideNotify in eta-notifier.ts.
//
//   - Skip planned/arrived/low-confidence predictions — not a dynamic signal,
//     or too uncertain to be worth a buzz.
//   - Notify on the FIRST confident ETA (customer gets an initial estimate).
//   - Otherwise notify only when the ETA moved ≥ threshold vs. last told.
//
// This keeps the customer informed without spamming on every GPS tick.
//
// lastNotifiedEtaAt is the ETA the customer was last told about (nil if none).
// thresholdMinutes ≤ 0 → DefaultNotifyThresholdMinutes (mirrors the TS `?? 15`;
// a 0/negative threshold would re-notify on every tick, which is never wanted).
func DecideNotify(p Prediction, lastNotifiedEtaAt *time.Time, thresholdMinutes int) NotifyDecision {
	threshold := thresholdMinutes
	if threshold <= 0 {
		threshold = DefaultNotifyThresholdMinutes
	}

	if p.EtaAt == nil {
		return NotifyDecision{Reason: "no ETA produced"}
	}
	if p.Method == MethodPlanned || p.Method == MethodArrived {
		return NotifyDecision{Reason: fmt.Sprintf("method '%s' is not a proactive ETA shift", p.Method)}
	}
	if p.Confidence == ConfidenceLow {
		return NotifyDecision{Reason: "confidence too low to notify"}
	}
	if lastNotifiedEtaAt == nil {
		return NotifyDecision{Notify: true, Reason: "first ETA for this shipment"}
	}

	delta := EtaDeltaMinutes(lastNotifiedEtaAt, p.EtaAt)
	if delta == nil {
		return NotifyDecision{Reason: "could not compute delta"}
	}
	abs := *delta
	if abs < 0 {
		abs = -abs
	}
	if abs >= threshold {
		return NotifyDecision{Notify: true, Reason: fmt.Sprintf("ETA moved %dmin (>= %dmin)", *delta, threshold), DeltaMinutes: delta}
	}
	return NotifyDecision{Reason: fmt.Sprintf("ETA moved only %dmin (< %dmin)", *delta, threshold), DeltaMinutes: delta}
}

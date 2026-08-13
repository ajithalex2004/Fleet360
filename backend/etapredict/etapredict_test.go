package etapredict

import (
	"testing"
	"time"

	"fleet360-backend/geo"
)

var base = time.Date(2026, 6, 23, 10, 0, 0, 0, time.UTC)

func tp(lat, lng float64, t time.Time) TrackingPoint {
	return TrackingPoint{LatLng: geo.LatLng{Latitude: lat, Longitude: lng}, OccurredAt: t}
}

func fp(f float64) *float64 { return &f }

func TestObservedSpeedKmh(t *testing.T) {
	cfg := DefaultConfig()

	t.Run("nil with fewer than two points", func(t *testing.T) {
		if s := ObservedSpeedKmh([]TrackingPoint{tp(25, 55, base)}, cfg); s != nil {
			t.Fatalf("expected nil for one point, got %v", *s)
		}
	})

	t.Run("nil when the window is too short in time", func(t *testing.T) {
		// 30s apart — below MinSpeedWindowSec=60.
		pts := []TrackingPoint{
			tp(25.0, 55.0, base),
			tp(25.009, 55.0, base.Add(30*time.Second)),
		}
		if s := ObservedSpeedKmh(pts, cfg); s != nil {
			t.Fatalf("expected nil for sub-minute window, got %v", *s)
		}
	})

	t.Run("~60km/h for 1km in 1 minute", func(t *testing.T) {
		// 0.009° lat ≈ 1km, over 60s → ~60km/h.
		pts := []TrackingPoint{
			tp(25.0, 55.0, base),
			tp(25.009, 55.0, base.Add(60*time.Second)),
		}
		s := ObservedSpeedKmh(pts, cfg)
		if s == nil {
			t.Fatal("expected a speed reading")
		}
		if *s < 55 || *s > 65 {
			t.Fatalf("expected ~60km/h, got %v", *s)
		}
	})

	t.Run("uses only the most recent window of points", func(t *testing.T) {
		// An old far-away outlier should be dropped (SpeedWindowPoints=5).
		pts := []TrackingPoint{
			tp(20.0, 50.0, base.Add(-1*time.Hour)), // outlier
			tp(25.000, 55.0, base.Add(1*time.Minute)),
			tp(25.009, 55.0, base.Add(2*time.Minute)),
			tp(25.018, 55.0, base.Add(3*time.Minute)),
			tp(25.027, 55.0, base.Add(4*time.Minute)),
			tp(25.036, 55.0, base.Add(5*time.Minute)),
		}
		s := ObservedSpeedKmh(pts, cfg)
		if s == nil {
			t.Fatal("expected a speed reading")
		}
		if *s < 55 || *s > 65 {
			t.Fatalf("expected ~60km/h from the recent window, got %v", *s)
		}
	})
}

func TestPredictEtaPlanned(t *testing.T) {
	planned := base.Add(2 * time.Hour)

	t.Run("no destination falls back to planned arrival", func(t *testing.T) {
		out := PredictEta(Input{
			TrackingPoints:   []TrackingPoint{tp(25, 55, base)},
			Destination:      nil,
			Now:              base,
			PlannedArrivalAt: &planned,
		})
		if out.Method != MethodPlanned || out.Confidence != ConfidenceLow {
			t.Fatalf("expected planned/low, got %s/%s", out.Method, out.Confidence)
		}
		if out.EtaAt == nil || !out.EtaAt.Equal(planned) {
			t.Fatalf("expected planned eta %v, got %v", planned, out.EtaAt)
		}
	})

	t.Run("no GPS pings falls back to planned arrival", func(t *testing.T) {
		dest := geo.LatLng{Latitude: 24.5, Longitude: 54.4}
		out := PredictEta(Input{
			TrackingPoints:   nil,
			Destination:      &dest,
			Now:              base,
			PlannedArrivalAt: &planned,
		})
		if out.Method != MethodPlanned {
			t.Fatalf("expected planned, got %s", out.Method)
		}
	})
}

func TestPredictEtaArrived(t *testing.T) {
	dest := geo.LatLng{Latitude: 25.0, Longitude: 55.0}
	// Current point ~100m from destination — within the 0.5km arrival radius.
	out := PredictEta(Input{
		TrackingPoints: []TrackingPoint{tp(25.0009, 55.0, base)},
		Destination:    &dest,
		Now:            base,
	})
	if out.Method != MethodArrived || out.Confidence != ConfidenceHigh {
		t.Fatalf("expected arrived/high, got %s/%s", out.Method, out.Confidence)
	}
	if out.EtaAt == nil || !out.EtaAt.Equal(base) {
		t.Fatalf("arrived eta should be now, got %v", out.EtaAt)
	}
}

func TestPredictEtaObservedSpeed(t *testing.T) {
	dest := geo.LatLng{Latitude: 25.5, Longitude: 55.0} // ~55km north
	// Two pings ~1km apart over 60s → ~60km/h observed.
	pts := []TrackingPoint{
		tp(25.0, 55.0, base.Add(-60*time.Second)),
		tp(25.009, 55.0, base),
	}
	out := PredictEta(Input{TrackingPoints: pts, Destination: &dest, Now: base})

	if out.Method != MethodObservedSpeed || out.Confidence != ConfidenceHigh {
		t.Fatalf("expected observed-speed/high, got %s/%s", out.Method, out.Confidence)
	}
	if out.EffectiveSpeedKmh == nil || *out.EffectiveSpeedKmh < 55 || *out.EffectiveSpeedKmh > 65 {
		t.Fatalf("expected ~60km/h effective speed, got %v", out.EffectiveSpeedKmh)
	}
	if out.RemainingKm == nil || *out.RemainingKm <= 0 {
		t.Fatalf("expected positive remaining km, got %v", out.RemainingKm)
	}
	if out.EtaAt == nil || !out.EtaAt.After(base) {
		t.Fatalf("eta should be after now, got %v", out.EtaAt)
	}
}

func TestPredictEtaStoppedUsesLaneAverage(t *testing.T) {
	dest := geo.LatLng{Latitude: 25.5, Longitude: 55.0}
	// Two near-identical pings over 60s → observed speed well below the 5km/h floor.
	pts := []TrackingPoint{
		tp(25.0, 55.0, base.Add(-60*time.Second)),
		tp(25.00001, 55.0, base),
	}
	out := PredictEta(Input{
		TrackingPoints:      pts,
		Destination:         &dest,
		Now:                 base,
		LaneAverageSpeedKmh: fp(40),
	})

	if out.Method != MethodLaneAverage || out.Confidence != ConfidenceMedium {
		t.Fatalf("expected lane-average/medium, got %s/%s", out.Method, out.Confidence)
	}
	if out.EffectiveSpeedKmh == nil || *out.EffectiveSpeedKmh != 40 {
		t.Fatalf("expected 40km/h lane average, got %v", out.EffectiveSpeedKmh)
	}
}

func TestPredictEtaDefaultSpeed(t *testing.T) {
	dest := geo.LatLng{Latitude: 25.5, Longitude: 55.0}
	// Single ping → no observed speed; no lane average → default 60km/h.
	out := PredictEta(Input{
		TrackingPoints: []TrackingPoint{tp(25.0, 55.0, base)},
		Destination:    &dest,
		Now:            base,
	})

	if out.Method != MethodDefaultSpeed || out.Confidence != ConfidenceLow {
		t.Fatalf("expected default-speed/low, got %s/%s", out.Method, out.Confidence)
	}
	if out.EffectiveSpeedKmh == nil || *out.EffectiveSpeedKmh != 60 {
		t.Fatalf("expected 60km/h default, got %v", out.EffectiveSpeedKmh)
	}
}

func TestPredictEtaRemainingUsesDetourFactor(t *testing.T) {
	dest := geo.LatLng{Latitude: 26.0, Longitude: 55.0} // 1° north ≈ 111km crow
	out := PredictEta(Input{
		TrackingPoints: []TrackingPoint{tp(25.0, 55.0, base)},
		Destination:    &dest,
		Now:            base,
	})
	if out.RemainingKm == nil {
		t.Fatal("expected remaining km")
	}
	// ~111km crow × 1.3 detour ≈ 144km.
	if *out.RemainingKm < 140 || *out.RemainingKm > 150 {
		t.Fatalf("expected ~144km road distance, got %v", *out.RemainingKm)
	}
}

func TestEtaDeltaMinutes(t *testing.T) {
	a := base
	b := base.Add(25 * time.Minute)

	if EtaDeltaMinutes(nil, &b) != nil || EtaDeltaMinutes(&a, nil) != nil {
		t.Fatal("nil input should give nil delta")
	}
	d := EtaDeltaMinutes(&a, &b)
	if d == nil || *d != 25 {
		t.Fatalf("expected +25 minutes, got %v", d)
	}
	dNeg := EtaDeltaMinutes(&b, &a)
	if dNeg == nil || *dNeg != -25 {
		t.Fatalf("expected -25 minutes, got %v", dNeg)
	}
}

func TestDecideNotify(t *testing.T) {
	eta := base.Add(90 * time.Minute)
	confident := Prediction{EtaAt: &eta, Method: MethodObservedSpeed, Confidence: ConfidenceHigh}

	t.Run("no eta → no notify", func(t *testing.T) {
		d := DecideNotify(Prediction{Method: MethodObservedSpeed, Confidence: ConfidenceHigh}, nil, 15)
		if d.Notify {
			t.Fatalf("expected no notify when eta is nil, got %+v", d)
		}
	})

	t.Run("planned/arrived methods don't notify", func(t *testing.T) {
		for _, m := range []Method{MethodPlanned, MethodArrived} {
			d := DecideNotify(Prediction{EtaAt: &eta, Method: m, Confidence: ConfidenceHigh}, nil, 15)
			if d.Notify {
				t.Fatalf("method %s should not notify, got %+v", m, d)
			}
		}
	})

	t.Run("low confidence doesn't notify", func(t *testing.T) {
		d := DecideNotify(Prediction{EtaAt: &eta, Method: MethodLaneAverage, Confidence: ConfidenceLow}, nil, 15)
		if d.Notify {
			t.Fatalf("low confidence should not notify, got %+v", d)
		}
	})

	t.Run("first confident ETA notifies", func(t *testing.T) {
		d := DecideNotify(confident, nil, 15)
		if !d.Notify || d.DeltaMinutes != nil {
			t.Fatalf("expected first-ETA notify with nil delta, got %+v", d)
		}
	})

	t.Run("small shift below threshold doesn't notify", func(t *testing.T) {
		last := eta.Add(-5 * time.Minute) // ETA moved +5min
		d := DecideNotify(confident, &last, 15)
		if d.Notify {
			t.Fatalf("a 5min shift below the 15min threshold should not notify, got %+v", d)
		}
		if d.DeltaMinutes == nil || *d.DeltaMinutes != 5 {
			t.Fatalf("expected delta +5, got %v", d.DeltaMinutes)
		}
	})

	t.Run("shift at/over threshold notifies", func(t *testing.T) {
		last := eta.Add(-20 * time.Minute) // ETA moved +20min
		d := DecideNotify(confident, &last, 15)
		if !d.Notify || d.DeltaMinutes == nil || *d.DeltaMinutes != 20 {
			t.Fatalf("expected notify with delta +20, got %+v", d)
		}
	})

	t.Run("non-positive threshold falls back to the default", func(t *testing.T) {
		last := eta.Add(-16 * time.Minute) // +16min: under nothing, over the 15 default
		if d := DecideNotify(confident, &last, 0); !d.Notify {
			t.Fatalf("threshold 0 should default to %dmin and notify on a 16min shift, got %+v", DefaultNotifyThresholdMinutes, d)
		}
	})
}

package analytics

import (
	"testing"
	"time"
)

// Reference clock for tests — beats Date.now() randomness and gives us
// a stable "now" relative to the synthetic event dates below.
var testNow = time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)

func days(n int) time.Duration { return time.Duration(n) * 24 * time.Hour }

func TestComputeIntervalStats_RequiresAtLeastTwoEvents(t *testing.T) {
	if _, ok := ComputeIntervalStats(nil); ok {
		t.Error("nil events should produce no stats")
	}
	one := []ServiceEvent{{Odometer: 10000, CompletedAt: testNow.Add(-days(30))}}
	if _, ok := ComputeIntervalStats(one); ok {
		t.Error("single event should produce no stats (no interval to measure)")
	}
}

func TestComputeIntervalStats_HappyPath_ThreeRegularServices(t *testing.T) {
	// Three brake services 10,000 km apart, 90 days apart.
	events := []ServiceEvent{
		{Odometer: 10000, CompletedAt: testNow.Add(-days(180))},
		{Odometer: 20000, CompletedAt: testNow.Add(-days(90))},
		{Odometer: 30000, CompletedAt: testNow},
	}
	stats, ok := ComputeIntervalStats(events)
	if !ok {
		t.Fatal("expected stats from 3 events")
	}
	if stats.SampleCount != 2 {
		t.Errorf("want 2 intervals from 3 events, got %d", stats.SampleCount)
	}
	if stats.MeanKm != 10000 {
		t.Errorf("want mean km = 10000, got %d", stats.MeanKm)
	}
	if stats.MeanDays != 90 {
		t.Errorf("want mean days = 90, got %d", stats.MeanDays)
	}
	if !stats.LastServiceAt.Equal(testNow) {
		t.Errorf("want LastServiceAt = testNow, got %v", stats.LastServiceAt)
	}
	if stats.LastOdometer != 30000 {
		t.Errorf("want LastOdometer = 30000, got %d", stats.LastOdometer)
	}
}

func TestComputeIntervalStats_HandlesUnsortedInput(t *testing.T) {
	events := []ServiceEvent{
		// Same data as happy path but order-shuffled — output must be identical.
		{Odometer: 30000, CompletedAt: testNow},
		{Odometer: 10000, CompletedAt: testNow.Add(-days(180))},
		{Odometer: 20000, CompletedAt: testNow.Add(-days(90))},
	}
	stats, ok := ComputeIntervalStats(events)
	if !ok {
		t.Fatal("expected stats")
	}
	if stats.MeanKm != 10000 || stats.MeanDays != 90 || stats.SampleCount != 2 {
		t.Errorf("unsorted input changed the result: %+v", stats)
	}
}

func TestComputeIntervalStats_SkipsNonPositiveDeltas(t *testing.T) {
	// A backdated record (negative day delta) and a same-odometer record
	// (zero km delta) must both be excluded from the mean.
	events := []ServiceEvent{
		{Odometer: 10000, CompletedAt: testNow.Add(-days(180))},
		{Odometer: 10000, CompletedAt: testNow.Add(-days(170))}, // zero km delta — skip
		{Odometer: 20000, CompletedAt: testNow.Add(-days(170))}, // zero day delta — skip
		{Odometer: 30000, CompletedAt: testNow.Add(-days(90))},  // real interval: 20k→30k, 80 days
		{Odometer: 40000, CompletedAt: testNow},                 // real interval: 30k→40k, 90 days
	}
	stats, ok := ComputeIntervalStats(events)
	if !ok {
		t.Fatal("expected stats")
	}
	if stats.SampleCount != 2 {
		t.Errorf("want 2 valid intervals (others should be skipped), got %d", stats.SampleCount)
	}
	if stats.MeanKm != 10000 {
		t.Errorf("want mean km = 10000, got %d", stats.MeanKm)
	}
	// Mean days = (80 + 90) / 2 = 85
	if stats.MeanDays != 85 {
		t.Errorf("want mean days = 85, got %d", stats.MeanDays)
	}
}

func TestProjectNextDue_OnSchedule(t *testing.T) {
	stats := IntervalStats{
		SampleCount: 3, MeanKm: 10000, MeanDays: 90,
		LastServiceAt: testNow.Add(-days(30)),
		LastOdometer:  30000,
	}
	p := ProjectNextDue(stats, 32000, testNow)
	if p.Status != "on_schedule" {
		t.Errorf("want on_schedule, got %q (p=%+v)", p.Status, p)
	}
	if p.NextDueAtKm != 40000 {
		t.Errorf("want next due km = 40000, got %d", p.NextDueAtKm)
	}
	if p.KmRemaining != 8000 {
		t.Errorf("want km remaining = 8000, got %d", p.KmRemaining)
	}
}

func TestProjectNextDue_DueSoon_ByKm(t *testing.T) {
	stats := IntervalStats{
		SampleCount: 3, MeanKm: 10000, MeanDays: 90,
		LastServiceAt: testNow.Add(-days(50)),
		LastOdometer:  30000,
	}
	// Vehicle has racked up 9,500 km — only 500 km until projected due,
	// which is ≤ 10% of MeanKm = 1000.
	p := ProjectNextDue(stats, 39500, testNow)
	if p.Status != "due_soon" {
		t.Errorf("want due_soon, got %q (p=%+v)", p.Status, p)
	}
}

func TestProjectNextDue_Overdue_ByKm(t *testing.T) {
	stats := IntervalStats{
		SampleCount: 3, MeanKm: 10000, MeanDays: 90,
		LastServiceAt: testNow.Add(-days(60)),
		LastOdometer:  30000,
	}
	p := ProjectNextDue(stats, 41000, testNow) // already past 40k
	if p.Status != "overdue" {
		t.Errorf("want overdue, got %q (p=%+v)", p.Status, p)
	}
	if p.KmRemaining != -1000 {
		t.Errorf("want km remaining = -1000 (overdue by 1000), got %d", p.KmRemaining)
	}
}

func TestProjectNextDue_Overdue_ByDate(t *testing.T) {
	stats := IntervalStats{
		SampleCount: 3, MeanKm: 10000, MeanDays: 90,
		LastServiceAt: testNow.Add(-days(120)), // 120 days ago, mean is 90 → 30 days overdue
		LastOdometer:  30000,
	}
	// Mileage-wise we still have headroom (35k vs 40k projected) but the
	// date-based check should still flag overdue.
	p := ProjectNextDue(stats, 35000, testNow)
	if p.Status != "overdue" {
		t.Errorf("want overdue by date, got %q (p=%+v)", p.Status, p)
	}
}

func TestProjectNextDue_ConservativeOfKmAndDate(t *testing.T) {
	// Last service 10 days ago at 30,000 km, vehicle is now at 38,000 km
	// (only 2,000 km below the 40,000 km projected next-due). The
	// date-only math says "80 days until due" (lastService + 90 - now);
	// the km-based math using the HISTORICAL daily rate (10000 km / 90
	// days = ~111 km/day) says "2000 / 111 = ~18 days." We deliberately
	// use the historical mean (stable) rather than the recent observed
	// rate (would react to anomalies). The function should pick the
	// sooner of the two — ~18 days, not 80.
	stats := IntervalStats{
		SampleCount: 3, MeanKm: 10000, MeanDays: 90,
		LastServiceAt: testNow.Add(-days(10)),
		LastOdometer:  30000,
	}
	p := ProjectNextDue(stats, 38000, testNow)
	if p.DaysRemaining >= 80 {
		t.Errorf("expected km-pace to override date math; got %d days (=date-only)", p.DaysRemaining)
	}
	if p.DaysRemaining < 15 || p.DaysRemaining > 22 {
		t.Errorf("expected ~18 days from km-pace math, got %d", p.DaysRemaining)
	}
}

func TestGroupByVehicleAndType_BinsCorrectly(t *testing.T) {
	events := []ServiceEvent{
		{VehicleID: "v1", MaintenanceType: "Brake Pads", Odometer: 10000, CompletedAt: testNow.Add(-days(90))},
		{VehicleID: "v1", MaintenanceType: "Brake Pads", Odometer: 20000, CompletedAt: testNow},
		{VehicleID: "v1", MaintenanceType: "Tires", Odometer: 15000, CompletedAt: testNow.Add(-days(60))},
		{VehicleID: "v2", MaintenanceType: "Brake Pads", Odometer: 5000, CompletedAt: testNow.Add(-days(30))},
		{VehicleID: "", MaintenanceType: "Battery", Odometer: 1000, CompletedAt: testNow}, // skip empty vehicle id
	}
	out := GroupByVehicleAndType(events)

	if len(out["v1"]["Brake Pads"]) != 2 {
		t.Errorf("v1 Brake Pads bin: want 2 events, got %d", len(out["v1"]["Brake Pads"]))
	}
	if len(out["v1"]["Tires"]) != 1 {
		t.Errorf("v1 Tires bin: want 1 event, got %d", len(out["v1"]["Tires"]))
	}
	if len(out["v2"]["Brake Pads"]) != 1 {
		t.Errorf("v2 Brake Pads bin: want 1 event, got %d", len(out["v2"]["Brake Pads"]))
	}
	if _, exists := out[""]; exists {
		t.Error("empty-vehicle-id events should be skipped, not bucketed under empty key")
	}
}

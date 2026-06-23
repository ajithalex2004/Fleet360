package handlers

// Unit tests for the planner's pure helpers — the parity-sensitive bits the VRP
// cutover depends on (cache-key normalisation, the JS-Date wall-clock window
// math, the num() fallback, the list clamps, and the order-preserving dedups).
// No DB, no gin context: every function under test is deterministic.

import (
	"testing"
	"time"

	"fleet360-backend/routeopt"
)

func TestNormaliseAddress(t *testing.T) {
	cases := map[string]string{
		"  Sheikh Zayed Rd, Dubai.  ":       "sheikh zayed rd dubai",
		"Jebel Ali (Gate 4); Warehouse 'A'": "jebel ali gate 4 warehouse a",
		"DIP\t\tPhase   2":                  "dip phase 2",
		"`Al Quoz`":                         "al quoz",
		"":                                  "",
	}
	for in, want := range cases {
		if got := normaliseAddress(in); got != want {
			t.Errorf("normaliseAddress(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestToMinutesFromMidnight(t *testing.T) {
	if got := toMinutesFromMidnight(nil); got != nil {
		t.Fatalf("nil time should map to nil, got %v", *got)
	}
	// 08:30 UTC → 8*60+30 = 510, regardless of the location the time carries:
	// the helper reduces to UTC wall-clock first (parity with getUTCHours/Minutes).
	loc := time.FixedZone("GST", 4*3600)
	at := time.Date(2026, 6, 23, 12, 30, 0, 0, loc) // 12:30 +04:00 == 08:30 UTC
	got := toMinutesFromMidnight(&at)
	if got == nil || *got != 510 {
		t.Fatalf("toMinutesFromMidnight(12:30+04) = %v, want 510", got)
	}
	mid := time.Date(2026, 6, 23, 0, 0, 0, 0, time.UTC)
	if g := toMinutesFromMidnight(&mid); g == nil || *g != 0 {
		t.Fatalf("midnight UTC = %v, want 0", g)
	}
}

func TestNumPtr(t *testing.T) {
	v := 42.5
	if got := numPtr(&v, 7); got != 42.5 {
		t.Errorf("numPtr(&42.5,7) = %v, want 42.5", got)
	}
	if got := numPtr(nil, 7); got != 7 {
		t.Errorf("numPtr(nil,7) = %v, want 7 (fallback)", got)
	}
}

func TestClampInt(t *testing.T) {
	cases := []struct{ v, lo, hi, want int }{
		{0, 1, 100, 1},
		{20, 1, 100, 20},
		{500, 1, 100, 100},
		{-3, 1, 365, 1},
		{400, 1, 365, 365},
	}
	for _, c := range cases {
		if got := clampInt(c.v, c.lo, c.hi); got != c.want {
			t.Errorf("clampInt(%d,%d,%d) = %d, want %d", c.v, c.lo, c.hi, got, c.want)
		}
	}
}

func TestUniqueStrings(t *testing.T) {
	in := []string{"b", "a", "b", "c", "a"}
	got := uniqueStrings(in)
	want := []string{"b", "a", "c"} // first-seen order preserved
	if len(got) != len(want) {
		t.Fatalf("uniqueStrings = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("uniqueStrings = %v, want %v", got, want)
		}
	}
}

func TestUniqueShipmentIDs(t *testing.T) {
	stops := []routeopt.RouteStop{
		{ShipmentID: "s1", Type: routeopt.Pickup},
		{ShipmentID: "s2", Type: routeopt.Pickup},
		{ShipmentID: "s1", Type: routeopt.Delivery},
		{ShipmentID: "s2", Type: routeopt.Delivery},
	}
	got := uniqueShipmentIDs(stops)
	if len(got) != 2 || got[0] != "s1" || got[1] != "s2" {
		t.Fatalf("uniqueShipmentIDs = %v, want [s1 s2]", got)
	}
}

func TestFirstNonEmpty(t *testing.T) {
	addr := "  Warehouse 4  "
	loc := "Jebel Ali"
	blank := "   "
	if got := firstNonEmpty(&addr, &loc); got != addr {
		t.Errorf("firstNonEmpty prefers first non-empty, got %q", got)
	}
	if got := firstNonEmpty(nil, &loc); got != loc {
		t.Errorf("firstNonEmpty(nil, loc) = %q, want %q", got, loc)
	}
	if got := firstNonEmpty(&blank, &loc); got != loc {
		t.Errorf("firstNonEmpty(blank, loc) = %q, want %q (blank skipped)", got, loc)
	}
	if got := firstNonEmpty(nil, nil); got != "" {
		t.Errorf("firstNonEmpty(nil,nil) = %q, want empty", got)
	}
}

func TestLabelOr(t *testing.T) {
	plate := "DXB-12345"
	if got := labelOr(&plate, "abcdef0123456789"); got != plate {
		t.Errorf("labelOr should prefer primary, got %q", got)
	}
	if got := labelOr(nil, "abcdef0123456789"); got != "abcdef01" {
		t.Errorf("labelOr(nil, long-id) = %q, want first 8 chars", got)
	}
	if got := labelOr(nil, "short"); got != "short" {
		t.Errorf("labelOr(nil, short-id) = %q, want whole id", got)
	}
}

func TestCfgAccessors(t *testing.T) {
	cfg := map[string]any{
		"distanceProvider": "haversine",
		"detourFactor":     1.4,     // JSON numbers decode to float64
		"depotLatitude":    "25.07", // string-encoded number tolerated
		"depotLongitude":   55.14,
	}
	if got := cfgString(cfg, "distanceProvider"); got != "haversine" {
		t.Errorf("cfgString = %q", got)
	}
	if got := cfgString(cfg, "missing"); got != "" {
		t.Errorf("cfgString(missing) = %q, want empty", got)
	}
	if got := cfgFloat(cfg, "detourFactor", 1.3); got != 1.4 {
		t.Errorf("cfgFloat = %v, want 1.4", got)
	}
	if got := cfgFloat(cfg, "missing", 1.3); got != 1.3 {
		t.Errorf("cfgFloat(missing) = %v, want fallback 1.3", got)
	}
	if got := cfgFloatPtr(cfg, "depotLatitude"); got == nil || *got != 25.07 {
		t.Errorf("cfgFloatPtr(string-number) = %v, want 25.07", got)
	}
	if got := cfgFloatPtr(cfg, "depotLongitude"); got == nil || *got != 55.14 {
		t.Errorf("cfgFloatPtr(float) = %v, want 55.14", got)
	}
	if got := cfgFloatPtr(cfg, "missing"); got != nil {
		t.Errorf("cfgFloatPtr(missing) = %v, want nil", got)
	}
}

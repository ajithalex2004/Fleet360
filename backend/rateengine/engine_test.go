package rateengine

import (
	"strings"
	"testing"
	"time"
)

// ptr helpers keep the table-driven cases readable.
func sp(s string) *string   { return &s }
func fp(f float64) *float64 { return &f }
func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}
func dp(y int, m time.Month, d int) *time.Time { t := date(y, m, d); return &t }

// ── ScoreContract — weights must match rate-engine.ts exactly ──────────────

func TestScoreContract(t *testing.T) {
	req := Request{
		CustomerID:   sp("cust-1"),
		CarrierID:    sp("carr-1"),
		VehicleType:  sp("REEFER"),
		ServiceLevel: sp("EXPRESS"),
	}

	cases := []struct {
		name string
		c    Candidate
		want int
	}{
		{
			name: "fully specific contract scores the max",
			c:    Candidate{CustomerID: sp("cust-1"), CarrierID: sp("carr-1"), VehicleType: sp("REEFER"), ServiceLevel: sp("EXPRESS")},
			want: 100 + 40 + 30 + 15,
		},
		{
			name: "fully generic contract scores the generic credits",
			c:    Candidate{}, // all nil
			want: 10 + 5 + 5 + 3,
		},
		{
			name: "customer-specific beats vehicle+service generic",
			c:    Candidate{CustomerID: sp("cust-1")},
			want: 100 + 5 + 5 + 3,
		},
		{
			name: "vehicle match is case-insensitive",
			c:    Candidate{VehicleType: sp("reefer")},
			want: 10 + 5 + 30 + 3,
		},
		{
			name: "wrong customer earns nothing on the customer axis",
			c:    Candidate{CustomerID: sp("other")},
			want: 0 + 5 + 5 + 3,
		},
		{
			name: "wrong vehicle (non-nil mismatch) earns nothing on that axis",
			c:    Candidate{VehicleType: sp("FLATBED")},
			want: 10 + 5 + 0 + 3,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, _ := ScoreContract(tc.c, req)
			if got != tc.want {
				t.Fatalf("ScoreContract = %d, want %d", got, tc.want)
			}
		})
	}
}

// ── IsActiveOn — status + effective window, inclusive bounds ───────────────

func TestIsActiveOn(t *testing.T) {
	on := date(2026, time.June, 15)
	cases := []struct {
		name string
		c    Candidate
		want bool
	}{
		{"active, no window", Candidate{Status: "ACTIVE"}, true},
		{"inactive status", Candidate{Status: "EXPIRED"}, false},
		{"before window", Candidate{Status: "ACTIVE", EffectiveFrom: dp(2026, time.June, 16)}, false},
		{"on from-bound (inclusive)", Candidate{Status: "ACTIVE", EffectiveFrom: dp(2026, time.June, 15)}, true},
		{"on to-bound (inclusive)", Candidate{Status: "ACTIVE", EffectiveTo: dp(2026, time.June, 15)}, true},
		{"after window", Candidate{Status: "ACTIVE", EffectiveTo: dp(2026, time.June, 14)}, false},
		{"inside both bounds", Candidate{Status: "ACTIVE", EffectiveFrom: dp(2026, time.June, 1), EffectiveTo: dp(2026, time.June, 30)}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsActiveOn(tc.c, on); got != tc.want {
				t.Fatalf("IsActiveOn = %v, want %v", got, tc.want)
			}
		})
	}
}

// ── ComputePrice — fuel surcharge + min-charge floor ───────────────────────

func TestComputePrice(t *testing.T) {
	t.Run("base plus fuel surcharge", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: 1000, FuelPct: fp(10)})
		if p.FuelSurchargeAmount != 100 {
			t.Fatalf("fuel amount = %v, want 100", p.FuelSurchargeAmount)
		}
		if p.Subtotal != 1100 || p.Total != 1100 {
			t.Fatalf("subtotal/total = %v/%v, want 1100/1100", p.Subtotal, p.Total)
		}
		if p.MinChargeApplied {
			t.Fatal("min charge should not be applied")
		}
		// A flat contract reports rateMode "flat" and no basis applied.
		if p.RateMode != "flat" || p.RateBasisApplied {
			t.Fatalf("flat contract audit = %q/%v, want flat/false", p.RateMode, p.RateBasisApplied)
		}
	})

	t.Run("min charge floors the total", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: 100, FuelPct: fp(10), MinCharge: fp(500)})
		// subtotal = 110, min charge 500 floors it
		if p.Subtotal != 110 {
			t.Fatalf("subtotal = %v, want 110", p.Subtotal)
		}
		if p.Total != 500 {
			t.Fatalf("total = %v, want 500 (min charge floor)", p.Total)
		}
		if !p.MinChargeApplied {
			t.Fatal("min charge should be applied")
		}
	})

	t.Run("min charge below subtotal does not apply", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: 1000, MinCharge: fp(500)})
		if p.Total != 1000 || p.MinChargeApplied {
			t.Fatalf("total = %v applied=%v, want 1000/false", p.Total, p.MinChargeApplied)
		}
	})

	t.Run("negative inputs clamp to zero", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: -50, FuelPct: fp(-5), MinCharge: fp(-10)})
		if p.BaseRate != 0 || p.FuelSurchargePct != 0 || p.Total != 0 {
			t.Fatalf("clamp failed: %+v", p)
		}
	})

	t.Run("rounds money to 2dp", func(t *testing.T) {
		// 333.33 * 7.5% = 24.99975 -> 25.00
		p := ComputePrice(PriceInput{BaseRate: 333.33, FuelPct: fp(7.5)})
		if p.FuelSurchargeAmount != 25.0 {
			t.Fatalf("fuel = %v, want 25.00", p.FuelSurchargeAmount)
		}
	})
}

// ── Rate basis — per-km / per-kg / breakpoints ─────────────────────────────

func TestComputePricePerKm(t *testing.T) {
	// 2.50 AED/km × 400 km = 1000 base; +10% fuel = 1100.
	p := ComputePrice(PriceInput{
		RateBasis:  &RateBasis{Mode: RatePerKm, RatePerUnit: 2.5},
		FuelPct:    fp(10),
		DistanceKm: fp(400),
	})
	if !p.RateBasisApplied || p.RateMode != "per_km" {
		t.Fatalf("basis audit = applied %v mode %q, want true/per_km", p.RateBasisApplied, p.RateMode)
	}
	if p.BaseRate != 1000 || p.RateQuantity != 400 || p.RatePerUnit != 2.5 {
		t.Fatalf("base/qty/perUnit = %v/%v/%v, want 1000/400/2.5", p.BaseRate, p.RateQuantity, p.RatePerUnit)
	}
	if p.FuelSurchargeAmount != 100 || p.Total != 1100 {
		t.Fatalf("fuel/total = %v/%v, want 100/1100", p.FuelSurchargeAmount, p.Total)
	}
}

func TestComputePricePerKg(t *testing.T) {
	// 1.50 AED/kg × 1000 kg = 1500 base.
	p := ComputePrice(PriceInput{
		RateBasis: &RateBasis{Mode: RatePerKg, RatePerUnit: 1.5},
		WeightKg:  fp(1000),
	})
	if !p.RateBasisApplied || p.RateMode != "per_kg" || p.BaseRate != 1500 {
		t.Fatalf("per_kg = applied %v mode %q base %v, want true/per_kg/1500", p.RateBasisApplied, p.RateMode, p.BaseRate)
	}
}

func TestComputePriceBreakpoints(t *testing.T) {
	// Distance breaks: cheaper per-km the further you go (bracket-rate, whole
	// quantity at the selected tier's rate).
	basis := &RateBasis{
		Mode:        RatePerKm,
		RatePerUnit: 3.0, // floor rate when below every breakpoint
		Breakpoints: []Breakpoint{
			{MinQuantity: 200, RatePerUnit: fp(2.5)},
			{MinQuantity: 500, RatePerUnit: fp(2.0)},
			{MinQuantity: 1000, FlatAmount: fp(1800)},
		},
	}
	cases := []struct {
		name     string
		dist     float64
		wantBase float64
		wantRate float64 // effective per-unit; 0 for a flat tier
	}{
		{"below first breakpoint uses floor rate", 100, 300, 3.0}, // 3.0 × 100
		{"first tier", 300, 750, 2.5},                             // 2.5 × 300
		{"second tier", 600, 1200, 2.0},                           // 2.0 × 600
		{"on a breakpoint boundary is inclusive", 500, 1000, 2.0}, // 2.0 × 500
		{"flat-amount tier ignores quantity", 1500, 1800, 0},      // flat 1800
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := ComputePrice(PriceInput{RateBasis: basis, DistanceKm: fp(tc.dist)})
			if p.BaseRate != tc.wantBase || p.RatePerUnit != tc.wantRate {
				t.Fatalf("base/perUnit = %v/%v, want %v/%v", p.BaseRate, p.RatePerUnit, tc.wantBase, tc.wantRate)
			}
			if !p.RateBasisApplied {
				t.Fatal("expected the basis to apply")
			}
		})
	}
}

func TestComputePriceBasisFallsBackToFlat(t *testing.T) {
	basis := &RateBasis{Mode: RatePerKm, RatePerUnit: 2.0}

	t.Run("missing distance falls back to flat base_rate", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: 900, RateBasis: basis}) // no DistanceKm
		if p.RateBasisApplied {
			t.Fatal("basis should NOT apply without a quantity")
		}
		if p.BaseRate != 900 {
			t.Fatalf("base = %v, want 900 (flat fallback)", p.BaseRate)
		}
		if p.RateMode != "per_km" {
			t.Fatalf("rateMode = %q, want per_km (the intended, un-applied mode)", p.RateMode)
		}
		if !strings.Contains(p.RateBasisNote, "flat base_rate") {
			t.Fatalf("note should explain the fallback, got %q", p.RateBasisNote)
		}
	})

	t.Run("zero distance also falls back", func(t *testing.T) {
		p := ComputePrice(PriceInput{BaseRate: 750, RateBasis: basis, DistanceKm: fp(0)})
		if p.RateBasisApplied || p.BaseRate != 750 {
			t.Fatalf("zero qty: applied %v base %v, want false/750", p.RateBasisApplied, p.BaseRate)
		}
	})
}

func TestParseRateBasis(t *testing.T) {
	t.Run("nil and absent metadata yield no basis", func(t *testing.T) {
		if ParseRateBasis(nil) != nil {
			t.Fatal("nil metadata should yield nil basis")
		}
		if ParseRateBasis(map[string]any{"other": 1}) != nil {
			t.Fatal("metadata without rateBasis should yield nil")
		}
	})

	t.Run("flat mode yields nil (use base_rate)", func(t *testing.T) {
		b := ParseRateBasis(map[string]any{"rateBasis": map[string]any{"mode": "flat"}})
		if b != nil {
			t.Fatalf("flat mode should parse to nil, got %+v", b)
		}
	})

	t.Run("per_km with breakpoints parses fully", func(t *testing.T) {
		// Shapes mirror what GORM's serializer:json produces: float64 numbers,
		// []any arrays, map[string]any objects.
		b := ParseRateBasis(map[string]any{
			"rateBasis": map[string]any{
				"mode":        "per_km",
				"ratePerUnit": 2.5,
				"breakpoints": []any{
					map[string]any{"minQuantity": 0.0, "ratePerUnit": 2.5},
					map[string]any{"minQuantity": 500.0, "ratePerUnit": 1.75},
					map[string]any{"minQuantity": 1000.0, "flatAmount": 1500.0},
				},
			},
		})
		if b == nil || b.Mode != RatePerKm || b.RatePerUnit != 2.5 {
			t.Fatalf("parse = %+v, want per_km/2.5", b)
		}
		if len(b.Breakpoints) != 3 {
			t.Fatalf("breakpoints = %d, want 3", len(b.Breakpoints))
		}
		if b.Breakpoints[1].RatePerUnit == nil || *b.Breakpoints[1].RatePerUnit != 1.75 {
			t.Fatalf("tier[1].ratePerUnit = %v, want 1.75", b.Breakpoints[1].RatePerUnit)
		}
		if b.Breakpoints[2].FlatAmount == nil || *b.Breakpoints[2].FlatAmount != 1500 {
			t.Fatalf("tier[2].flatAmount = %v, want 1500", b.Breakpoints[2].FlatAmount)
		}
	})

	t.Run("tolerates int and string numerics", func(t *testing.T) {
		b := ParseRateBasis(map[string]any{
			"rateBasis": map[string]any{
				"mode":        "PerKg", // alternate spelling
				"ratePerUnit": "1.25",  // numeric string
				"breakpoints": []any{
					map[string]any{"minQuantity": 100, "ratePerUnit": 1}, // ints
				},
			},
		})
		if b == nil || b.Mode != RatePerKg || b.RatePerUnit != 1.25 {
			t.Fatalf("coercion parse = %+v, want per_kg/1.25", b)
		}
		if b.Breakpoints[0].MinQuantity != 100 || *b.Breakpoints[0].RatePerUnit != 1 {
			t.Fatalf("int tier parse = %+v", b.Breakpoints[0])
		}
	})
}

func TestEvaluateRateBasisSelectsHighestTier(t *testing.T) {
	// Unsorted breakpoints — selection must be sort-independent.
	b := &RateBasis{
		Mode: RatePerKg,
		Breakpoints: []Breakpoint{
			{MinQuantity: 1000, RatePerUnit: fp(1.0)},
			{MinQuantity: 100, RatePerUnit: fp(2.0)},
			{MinQuantity: 500, RatePerUnit: fp(1.5)},
		},
	}
	res := b.Evaluate(nil, fp(750)) // 750 kg → 500-tier @ 1.5
	if !res.Applied || res.RatePerUnit != 1.5 || res.Base != 1125 {
		t.Fatalf("evaluate = applied %v perUnit %v base %v, want true/1.5/1125", res.Applied, res.RatePerUnit, res.Base)
	}
}

// ── Quote — end-to-end selection pipeline ──────────────────────────────────

func TestQuote(t *testing.T) {
	shipDate := date(2026, time.June, 15)

	t.Run("empty candidate list -> no-lane-match", func(t *testing.T) {
		r := Quote(nil, Request{ShipmentDate: shipDate})
		if r.Matched || r.Reason != ReasonNoLaneMatch {
			t.Fatalf("got matched=%v reason=%v", r.Matched, r.Reason)
		}
		if r.Alternates == nil {
			t.Fatal("Alternates should be a non-nil empty slice for JSON")
		}
	})

	t.Run("all candidates inactive -> no-active-contract", func(t *testing.T) {
		cands := []Candidate{{ID: "a", Status: "EXPIRED", BaseRate: 100}}
		r := Quote(cands, Request{ShipmentDate: shipDate})
		if r.Matched || r.Reason != ReasonNoActiveContract {
			t.Fatalf("got matched=%v reason=%v", r.Matched, r.Reason)
		}
	})

	t.Run("customer-specific contract wins over generic", func(t *testing.T) {
		cands := []Candidate{
			{ID: "generic", ContractNo: "G-1", Status: "ACTIVE", BaseRate: 900},
			{ID: "specific", ContractNo: "S-1", Status: "ACTIVE", BaseRate: 1000, CustomerID: sp("cust-1")},
		}
		r := Quote(cands, Request{CustomerID: sp("cust-1"), ShipmentDate: shipDate})
		if !r.Matched || r.ContractID == nil || *r.ContractID != "specific" {
			t.Fatalf("expected specific to win, got %+v", r.ContractID)
		}
		if r.BaseRate != 1000 {
			t.Fatalf("priced wrong contract: base = %v", r.BaseRate)
		}
		if len(r.Alternates) != 1 || r.Alternates[0].ContractID != "generic" {
			t.Fatalf("expected generic as the single alternate, got %+v", r.Alternates)
		}
	})

	t.Run("another customer's private rate is excluded for a generic request", func(t *testing.T) {
		cands := []Candidate{
			{ID: "private", Status: "ACTIVE", BaseRate: 1, CustomerID: sp("someone-else")},
			{ID: "generic", Status: "ACTIVE", BaseRate: 800},
		}
		// request carries NO customer -> only the generic contract is eligible
		r := Quote(cands, Request{ShipmentDate: shipDate})
		if !r.Matched || *r.ContractID != "generic" {
			t.Fatalf("expected generic to win, got %+v", r.ContractID)
		}
		if len(r.Alternates) != 0 {
			t.Fatalf("the private rate must not surface as an alternate, got %+v", r.Alternates)
		}
	})

	t.Run("equal score breaks toward the most recently created", func(t *testing.T) {
		cands := []Candidate{
			{ID: "old", Status: "ACTIVE", BaseRate: 500, CreatedAt: date(2026, time.January, 1)},
			{ID: "new", Status: "ACTIVE", BaseRate: 600, CreatedAt: date(2026, time.May, 1)},
		}
		r := Quote(cands, Request{ShipmentDate: shipDate})
		if *r.ContractID != "new" {
			t.Fatalf("expected newest to win the tie, got %v", *r.ContractID)
		}
	})

	t.Run("per-km contract prices off the request distance", func(t *testing.T) {
		cands := []Candidate{{
			ID: "perkm", ContractNo: "PK-1", Status: "ACTIVE",
			BaseRate:  0, // priced entirely by the basis
			RateBasis: &RateBasis{Mode: RatePerKm, RatePerUnit: 3.0},
		}}
		r := Quote(cands, Request{ShipmentDate: shipDate, DistanceKm: fp(250)})
		if !r.Matched || r.BaseRate != 750 || r.Total != 750 {
			t.Fatalf("per-km quote base/total = %v/%v, want 750/750", r.BaseRate, r.Total)
		}
		if !r.RateBasisApplied || r.RateMode != "per_km" {
			t.Fatalf("audit = applied %v mode %q, want true/per_km", r.RateBasisApplied, r.RateMode)
		}
	})

	t.Run("per-km contract with no distance falls back to its flat base_rate", func(t *testing.T) {
		cands := []Candidate{{
			ID: "perkm", ContractNo: "PK-1", Status: "ACTIVE",
			BaseRate:  450, // flat fallback when distance is unknown
			RateBasis: &RateBasis{Mode: RatePerKm, RatePerUnit: 3.0},
		}}
		r := Quote(cands, Request{ShipmentDate: shipDate}) // no DistanceKm
		if !r.Matched || r.BaseRate != 450 || r.RateBasisApplied {
			t.Fatalf("fallback quote base/applied = %v/%v, want 450/false", r.BaseRate, r.RateBasisApplied)
		}
	})
}

// ── SpotEstimate — non-contracted distance×rate fallback ───────────────────

func TestSpotEstimate(t *testing.T) {
	t.Run("prices distance × rate and is labelled non-contracted", func(t *testing.T) {
		r, ok := SpotEstimate(Request{DistanceKm: fp(250)}, 3.0, nil)
		if !ok {
			t.Fatal("expected an estimate")
		}
		if r.Matched || r.Reason != ReasonSpotEstimate || !r.Estimate {
			t.Fatalf("labelling wrong: matched=%v reason=%q estimate=%v", r.Matched, r.Reason, r.Estimate)
		}
		if r.ContractID != nil || r.ContractNo != nil {
			t.Fatal("an estimate must carry no contract id/no (keeps coverage honest)")
		}
		if r.BaseRate != 750 || r.Total != 750 || r.Currency != "AED" {
			t.Fatalf("base/total/currency = %v/%v/%q, want 750/750/AED", r.BaseRate, r.Total, r.Currency)
		}
		if r.Alternates == nil {
			t.Fatal("Alternates must be a non-nil slice for JSON")
		}
	})

	t.Run("min-charge floors a short-haul estimate", func(t *testing.T) {
		r, ok := SpotEstimate(Request{DistanceKm: fp(10)}, 3.0, fp(200))
		if !ok {
			t.Fatal("expected an estimate")
		}
		// base = 30, floored to the 200 min charge.
		if r.Total != 200 || !r.MinChargeApplied {
			t.Fatalf("total/applied = %v/%v, want 200/true", r.Total, r.MinChargeApplied)
		}
	})

	t.Run("no-op when rate or distance is missing/non-positive", func(t *testing.T) {
		if _, ok := SpotEstimate(Request{DistanceKm: fp(250)}, 0, nil); ok {
			t.Error("zero rate should not estimate")
		}
		if _, ok := SpotEstimate(Request{}, 3.0, nil); ok {
			t.Error("nil distance should not estimate")
		}
		if _, ok := SpotEstimate(Request{DistanceKm: fp(0)}, 3.0, nil); ok {
			t.Error("zero distance should not estimate")
		}
	})
}

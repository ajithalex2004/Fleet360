package accessorial

// Unit tests for the pure accessorial evaluator — parity with
// src/lib/logistics/accessorial-engine.ts. No DB, no gin: every function under
// test is deterministic. The amounts, the applies-decisions, and the
// taxable-resolution rule are the parity-sensitive bits the create-time
// auto-apply depends on.

import "testing"

func fptr(f float64) *float64 { return &f }
func sptr(s string) *string   { return &s }
func bptr(b bool) *bool       { return &b }

// ── flat ──────────────────────────────────────────────────────────────────────

func TestEvaluateFlat(t *testing.T) {
	r := ParseRule(map[string]any{"type": "flat", "amount": 150.0})
	if r == nil {
		t.Fatal("flat rule should parse")
	}
	v := EvaluateRule(r, Context{})
	if !v.Applies || v.Amount != 150 {
		t.Fatalf("flat 150 = %+v, want applies amount 150", v)
	}
	if !v.Taxable {
		t.Errorf("flat with no taxable key defaults taxable=true in the verdict, got %v", v.Taxable)
	}
}

func TestFlatZeroDoesNotApply(t *testing.T) {
	// amount rounds to 0 → non-applying (a bad/empty rule can't write a 0 row).
	r := ParseRule(map[string]any{"type": "flat", "amount": 0.0})
	if r == nil {
		t.Fatal("rule should parse")
	}
	if v := EvaluateRule(r, Context{}); v.Applies {
		t.Fatalf("flat 0 should not apply, got %+v", v)
	}
}

// ── percentage ────────────────────────────────────────────────────────────────

func TestEvaluatePercentageBasis(t *testing.T) {
	ctx := Context{BaseRate: fptr(1000), Subtotal: fptr(1200), CargoValue: fptr(50000)}

	cases := []struct {
		basis string
		want  float64
	}{
		{"base_rate", 100},    // 10% of 1000
		{"subtotal", 120},     // 10% of 1200
		{"cargo_value", 5000}, // 10% of 50000
	}
	for _, c := range cases {
		r := ParseRule(map[string]any{"type": "percentage", "basis": c.basis, "percentage": 10.0})
		if r == nil {
			t.Fatalf("percentage/%s should parse", c.basis)
		}
		v := EvaluateRule(r, ctx)
		if !v.Applies || v.Amount != c.want {
			t.Fatalf("10%% of %s = %+v, want %v", c.basis, v, c.want)
		}
	}
}

func TestPercentageBasisUnavailable(t *testing.T) {
	// basis present but the context lacks that number → non-applying, not a panic.
	r := ParseRule(map[string]any{"type": "percentage", "basis": "base_rate", "percentage": 10.0})
	if v := EvaluateRule(r, Context{}); v.Applies {
		t.Fatalf("percentage with no baseRate should not apply, got %+v", v)
	}
}

func TestPercentageRejectsBadBasis(t *testing.T) {
	if r := ParseRule(map[string]any{"type": "percentage", "basis": "weight", "percentage": 10.0}); r != nil {
		t.Fatalf("unknown basis should fail to parse, got %+v", r)
	}
	if r := ParseRule(map[string]any{"type": "percentage", "basis": "base_rate"}); r != nil {
		t.Fatal("missing percentage should fail to parse")
	}
}

// ── per_km (free + cap) ───────────────────────────────────────────────────────

func TestEvaluatePerKm(t *testing.T) {
	// 2/km, first 50 free, cap at 300. dist=400 → chargeable=min(350, 300-50)=250 → 500.
	r := ParseRule(map[string]any{"type": "per_km", "rate": 2.0, "freeKm": 50.0, "maxKm": 300.0})
	v := EvaluateRule(r, Context{DistanceKm: fptr(400)})
	if !v.Applies || v.Amount != 500 {
		t.Fatalf("per_km capped = %+v, want 500", v)
	}
	// Under the free allowance → 0 → non-applying.
	if v := EvaluateRule(r, Context{DistanceKm: fptr(40)}); v.Applies {
		t.Fatalf("per_km below free allowance should not apply, got %+v", v)
	}
}

// ── per_kg (free) ─────────────────────────────────────────────────────────────

func TestEvaluatePerKg(t *testing.T) {
	// 0.5/kg, first 1000 free. weight=3000 → 2000 chargeable → 1000.
	r := ParseRule(map[string]any{"type": "per_kg", "rate": 0.5, "freeKg": 1000.0})
	v := EvaluateRule(r, Context{WeightKg: fptr(3000)})
	if !v.Applies || v.Amount != 1000 {
		t.Fatalf("per_kg = %+v, want 1000", v)
	}
}

// ── per_stop (excludeFirst) ───────────────────────────────────────────────────

func TestEvaluatePerStop(t *testing.T) {
	r := ParseRule(map[string]any{"type": "per_stop", "rate": 25.0, "excludeFirst": true})
	// 4 stops, exclude first → 3 × 25 = 75.
	v := EvaluateRule(r, Context{StopsCount: fptr(4)})
	if !v.Applies || v.Amount != 75 {
		t.Fatalf("per_stop excludeFirst = %+v, want 75", v)
	}
	// Without excludeFirst → 4 × 25 = 100.
	r2 := ParseRule(map[string]any{"type": "per_stop", "rate": 25.0})
	if v := EvaluateRule(r2, Context{StopsCount: fptr(4)}); v.Amount != 100 {
		t.Fatalf("per_stop = %+v, want 100", v)
	}
}

// ── conditions gating ─────────────────────────────────────────────────────────

func TestConditionsGate(t *testing.T) {
	// Rule fires only on cross-border + min weight.
	raw := map[string]any{
		"type":   "flat",
		"amount": 200.0,
		"conditions": map[string]any{
			"minWeightKg":         1000.0,
			"requiresCrossBorder": true,
		},
	}
	r := ParseRule(raw)
	if r == nil {
		t.Fatal("rule should parse")
	}

	// Cross-border + heavy → applies.
	ctx := Context{WeightKg: fptr(2000), OriginCountry: sptr("AE"), DestinationCountry: sptr("SA")}
	if v := EvaluateRule(r, ctx); !v.Applies || v.Amount != 200 {
		t.Fatalf("gate satisfied = %+v, want applies 200", v)
	}
	// Same country → cross-border fails.
	ctx.DestinationCountry = sptr("AE")
	if v := EvaluateRule(r, ctx); v.Applies {
		t.Fatalf("same-country should fail cross-border gate, got %+v", v)
	}
	// Too light → weight gate fails.
	ctx = Context{WeightKg: fptr(500), OriginCountry: sptr("AE"), DestinationCountry: sptr("SA")}
	if v := EvaluateRule(r, ctx); v.Applies {
		t.Fatalf("underweight should fail gate, got %+v", v)
	}
}

func TestConditionsVehicleTypeCaseInsensitive(t *testing.T) {
	r := ParseRule(map[string]any{
		"type":   "flat",
		"amount": 50.0,
		"conditions": map[string]any{
			"vehicleTypes": []any{"REEFER", "FLATBED"},
		},
	})
	if v := EvaluateRule(r, Context{VehicleType: sptr("reefer")}); !v.Applies {
		t.Fatalf("reefer should match REEFER (case-insensitive), got %+v", v)
	}
	if v := EvaluateRule(r, Context{VehicleType: sptr("VAN")}); v.Applies {
		t.Fatalf("VAN should not match [REEFER,FLATBED], got %+v", v)
	}
}

func TestRequiresHazmatOnlyWhenTrue(t *testing.T) {
	// requiresHazmat:false must NOT gate (TS uses === true).
	r := ParseRule(map[string]any{
		"type": "flat", "amount": 10.0,
		"conditions": map[string]any{"requiresHazmat": false},
	})
	if v := EvaluateRule(r, Context{IsHazmat: false}); !v.Applies {
		t.Fatalf("requiresHazmat=false should not gate, got %+v", v)
	}
}

// ── ParseRule tolerance ───────────────────────────────────────────────────────

func TestParseRuleRejectsGarbage(t *testing.T) {
	bad := []map[string]any{
		nil,
		{},                                 // no type
		{"type": 7},                        // non-string type
		{"type": "flat"},                   // missing amount
		{"type": "flat", "amount": "lots"}, // amount not a number
		{"type": "per_km"},                 // missing rate
		{"type": "mystery", "amount": 1.0}, // unknown type
	}
	for i, b := range bad {
		if r := ParseRule(b); r != nil {
			t.Errorf("case %d: expected nil, got %+v", i, r)
		}
	}
}

// ── taxable resolution (the subtle one) ───────────────────────────────────────

func TestTaxableResolution(t *testing.T) {
	ctx := Context{}

	// Catalog row taxable=false, rule OMITS taxable → catalog default wins (false).
	cat := []CatalogEntry{{
		ID: "c1", Code: "CUSTOMS", Name: "Customs", ChargeType: "ACCESSORIAL",
		Currency: "AED", Taxable: false, Status: "ACTIVE",
		AutoApplyRule: map[string]any{"type": "flat", "amount": 100.0},
	}}
	got := ApplyAccessorialCatalog(cat, ctx)
	if len(got) != 1 || got[0].Taxable {
		t.Fatalf("rule omits taxable → catalog taxable=false should win, got %+v", got)
	}

	// Catalog row taxable=false, rule SETS taxable=true → rule overrides (true).
	cat[0].AutoApplyRule = map[string]any{"type": "flat", "amount": 100.0, "taxable": true}
	got = ApplyAccessorialCatalog(cat, ctx)
	if len(got) != 1 || !got[0].Taxable {
		t.Fatalf("rule taxable=true should override catalog false, got %+v", got)
	}

	// Catalog row taxable=true, rule SETS taxable=false → rule overrides (false).
	cat[0].Taxable = true
	cat[0].AutoApplyRule = map[string]any{"type": "flat", "amount": 100.0, "taxable": false}
	got = ApplyAccessorialCatalog(cat, ctx)
	if len(got) != 1 || got[0].Taxable {
		t.Fatalf("rule taxable=false should override catalog true, got %+v", got)
	}
}

// ── ApplyAccessorialCatalog filters ───────────────────────────────────────────

func TestApplyCatalogFilters(t *testing.T) {
	ctx := Context{WeightKg: fptr(2000), Subtotal: fptr(1000)}
	cat := []CatalogEntry{
		// ACTIVE + fires.
		{ID: "1", Code: "FUEL", Name: "Fuel", Currency: "AED", Taxable: true, Status: "ACTIVE",
			AutoApplyRule: map[string]any{"type": "percentage", "basis": "subtotal", "percentage": 15.0}},
		// INACTIVE → skipped even though the rule would fire.
		{ID: "2", Code: "OLD", Name: "Old", Currency: "AED", Taxable: true, Status: "INACTIVE",
			AutoApplyRule: map[string]any{"type": "flat", "amount": 999.0}},
		// No rule blob → skipped (manual-add only).
		{ID: "3", Code: "MANUAL", Name: "Manual", Currency: "AED", Taxable: true, Status: "ACTIVE",
			AutoApplyRule: nil},
		// Rule present but doesn't fire (gate fails) → skipped.
		{ID: "4", Code: "HEAVY", Name: "Heavy", Currency: "AED", Taxable: true, Status: "ACTIVE",
			AutoApplyRule: map[string]any{"type": "flat", "amount": 50.0,
				"conditions": map[string]any{"minWeightKg": 5000.0}}},
	}
	got := ApplyAccessorialCatalog(cat, ctx)
	if len(got) != 1 || got[0].Code != "FUEL" || got[0].Amount != 150 {
		t.Fatalf("only FUEL (15%% of 1000) should apply, got %+v", got)
	}
}

func TestCurrencyFallback(t *testing.T) {
	// Rule currency overrides; otherwise catalog currency; otherwise AED.
	ctx := Context{}
	cat := []CatalogEntry{{
		ID: "1", Code: "X", Name: "X", Currency: "USD", Taxable: true, Status: "ACTIVE",
		AutoApplyRule: map[string]any{"type": "flat", "amount": 10.0},
	}}
	if got := ApplyAccessorialCatalog(cat, ctx); got[0].Currency != "USD" {
		t.Fatalf("catalog currency should carry through, got %q", got[0].Currency)
	}
	cat[0].AutoApplyRule = map[string]any{"type": "flat", "amount": 10.0, "currency": "EUR"}
	if got := ApplyAccessorialCatalog(cat, ctx); got[0].Currency != "EUR" {
		t.Fatalf("rule currency should override, got %q", got[0].Currency)
	}
}

func TestRound2(t *testing.T) {
	// Parity with the TS engine's round2 = Math.round(n*100)/100. NOTE this is
	// NOT toFixed: the *100 step nudges the stored float onto a different side
	// of the .5 boundary than people expect from `(2.675).toFixed(2)` ("2.67").
	//   - 1.005*100 = 100.4999999999… (< 100.5) → rounds DOWN to 1.0
	//   - 2.675*100 = 267.5 exactly (the product rounds up onto 267.5) → 2.68
	// Both Go math.Round and JS Math.round round half away from zero for these
	// non-negative inputs, so Go and the TS engine agree value-for-value.
	cases := map[float64]float64{
		0.125:     0.13, // 12.5 exact → half rounds away from zero
		1.005:     1.0,  // 100.4999… < 100.5 → down (matches JS Math.round)
		2.675:     2.68, // 267.5 exact → up (matches JS Math.round, unlike toFixed)
		0.1 + 0.2: 0.3,  // 0.30000000000000004 → 0.3
	}
	for in, want := range cases {
		if got := round2(in); got != want {
			t.Errorf("round2(%v) = %v, want %v", in, got, want)
		}
	}
}

package rateengine

import (
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
		p := ComputePrice(1000, fp(10), nil)
		if p.FuelSurchargeAmount != 100 {
			t.Fatalf("fuel amount = %v, want 100", p.FuelSurchargeAmount)
		}
		if p.Subtotal != 1100 || p.Total != 1100 {
			t.Fatalf("subtotal/total = %v/%v, want 1100/1100", p.Subtotal, p.Total)
		}
		if p.MinChargeApplied {
			t.Fatal("min charge should not be applied")
		}
	})

	t.Run("min charge floors the total", func(t *testing.T) {
		p := ComputePrice(100, fp(10), fp(500))
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
		p := ComputePrice(1000, nil, fp(500))
		if p.Total != 1000 || p.MinChargeApplied {
			t.Fatalf("total = %v applied=%v, want 1000/false", p.Total, p.MinChargeApplied)
		}
	})

	t.Run("negative inputs clamp to zero", func(t *testing.T) {
		p := ComputePrice(-50, fp(-5), fp(-10))
		if p.BaseRate != 0 || p.FuelSurchargePct != 0 || p.Total != 0 {
			t.Fatalf("clamp failed: %+v", p)
		}
	})

	t.Run("rounds money to 2dp", func(t *testing.T) {
		// 333.33 * 7.5% = 24.99975 -> 25.00
		p := ComputePrice(333.33, fp(7.5), nil)
		if p.FuelSurchargeAmount != 25.0 {
			t.Fatalf("fuel = %v, want 25.00", p.FuelSurchargeAmount)
		}
	})
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
}

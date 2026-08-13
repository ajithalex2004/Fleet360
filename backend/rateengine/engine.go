// Package rateengine is the Go port of src/lib/logistics/rate-engine.ts.
//
// It picks the best applicable rate contract for a shipment and computes the
// customer-facing freight quote. The logic is intentionally pure — it takes
// a slice of candidate contracts and a request, and returns a result. The
// DB lookup (lane matching + ACTIVE filter, tenant-scoped) lives in the
// handler that calls Quote, mirroring the TS split between
// matchLaneRateContracts (DB) and the scoring/pricing (pure).
//
// Keeping it pure means the scoring weights, effective-date gating, and
// min-charge floor are exercised by unit tests with zero DB setup — the same
// property the TypeScript original was designed for.
package rateengine

import (
	"sort"
	"strings"
	"time"
)

// Candidate is one rate contract in contention, flattened from the
// logistics_rate_contracts row. Pointers mark nullable columns so the
// scorer can distinguish "any vehicle" (nil) from a specific match.
type Candidate struct {
	ID         string
	ContractNo string
	CustomerID *string
	CarrierID  *string

	VehicleType  *string
	ServiceLevel *string

	BaseRate         float64
	FuelSurchargePct *float64
	MinCharge        *float64

	// RateBasis is the optional quantity-based pricing rule (per-km / per-kg /
	// breakpoints), parsed from the contract's metadata JSONB. nil → the
	// contract prices flat off BaseRate (the default, and back-compatible).
	RateBasis *RateBasis

	EffectiveFrom *time.Time
	EffectiveTo   *time.Time
	Status        string
	Currency      string

	AccessorialRules map[string]any
	CreatedAt        time.Time
}

// Request is the shipment context a quote is computed against.
type Request struct {
	CustomerID   *string
	CarrierID    *string
	VehicleType  *string
	ServiceLevel *string
	ShipmentDate time.Time

	// DistanceKm / WeightKg are the shipment quantities a per-km / per-kg basis
	// prices against. nil when unknown at quote time — a quantity-based contract
	// then falls back to its flat base_rate (see ComputePrice).
	DistanceKm *float64
	WeightKg   *float64
}

// PricedQuote is the price breakdown for a single contract. BaseRate is the
// EFFECTIVE line-haul base actually used — the flat base_rate, or the amount a
// per-km/per-kg/breakpoint basis computed — so the downstream subtotal/margin
// math stays a single number regardless of how it was derived. The Rate* fields
// expose how that base came to be, for the operator's audit trail.
type PricedQuote struct {
	BaseRate            float64 `json:"baseRate"`
	FuelSurchargePct    float64 `json:"fuelSurchargePct"`
	FuelSurchargeAmount float64 `json:"fuelSurchargeAmount"`
	MinCharge           float64 `json:"minCharge"`
	MinChargeApplied    bool    `json:"minChargeApplied"`
	Subtotal            float64 `json:"subtotal"`
	Total               float64 `json:"total"`

	// Rate-basis audit: how BaseRate was derived.
	RateMode         string  `json:"rateMode"`         // flat | per_km | per_kg
	RateBasisApplied bool    `json:"rateBasisApplied"` // true when a quantity-based calc set BaseRate
	RateQuantity     float64 `json:"rateQuantity"`     // distance km or weight kg used (0 for flat)
	RatePerUnit      float64 `json:"ratePerUnit"`      // effective per-unit rate (0 for flat / flat-tier)
	RateBasisNote    string  `json:"rateBasisNote,omitempty"`
}

// Alternate is a runner-up contract surfaced for the operator's audit trail.
type Alternate struct {
	ContractID string `json:"contractId"`
	ContractNo string `json:"contractNo"`
	Score      int    `json:"score"`
	Why        string `json:"why"`
}

// Reason explains a quote outcome, matching the QuoteReason union in the TS.
type Reason string

const (
	ReasonMatched          Reason = "matched"
	ReasonNoLaneMatch      Reason = "no-lane-match"
	ReasonNoActiveContract Reason = "no-active-contract"
	// ReasonSpotEstimate marks a NON-contracted indicative quote produced by
	// SpotEstimate when no contract matched the lane. Matched stays false so the
	// shipment still counts as uncontracted in rate-coverage analytics.
	ReasonSpotEstimate Reason = "spot-estimate"
)

// DefaultCurrency mirrors the TS DEFAULT_CURRENCY.
const DefaultCurrency = "AED"

// Result is the full quote response.
type Result struct {
	Matched bool   `json:"matched"`
	Reason  Reason `json:"reason"`
	// Estimate is true ONLY for a SpotEstimate result — a non-contracted,
	// distance×rate indicative price. Consumers should label it as an estimate
	// and must NOT treat it as a contracted rate (no quotedContractId is set).
	Estimate bool `json:"estimate"`

	ContractID *string `json:"contractId"`
	ContractNo *string `json:"contractNo"`
	CustomerID *string `json:"customerId"`
	CarrierID  *string `json:"carrierId"`
	Currency   string  `json:"currency"`

	PricedQuote
	AccessorialRules map[string]any `json:"accessorialRules,omitempty"`
	Alternates       []Alternate    `json:"alternates"`
}

// ScoreContract returns the specificity score of a contract against a
// request, plus a human-readable "why". Weights match rate-engine.ts exactly:
// customer 100 / carrier 40 / vehicle 30 / service-level 15, with smaller
// credits for the generic (nil) side so a generic contract still beats no
// match but loses to a specific one.
func ScoreContract(c Candidate, r Request) (int, string) {
	score := 0
	reasons := make([]string, 0, 4)

	switch {
	case c.CustomerID != nil && eqPtr(r.CustomerID, c.CustomerID):
		score += 100
		reasons = append(reasons, "customer-specific")
	case c.CustomerID == nil:
		score += 10
		reasons = append(reasons, "generic-customer")
	}

	switch {
	case c.CarrierID != nil && eqPtr(r.CarrierID, c.CarrierID):
		score += 40
		reasons = append(reasons, "carrier-specific")
	case c.CarrierID == nil:
		score += 5
		reasons = append(reasons, "any-carrier")
	}

	switch {
	case c.VehicleType != nil && r.VehicleType != nil && eqFold(*c.VehicleType, *r.VehicleType):
		score += 30
		reasons = append(reasons, "exact-vehicle")
	case c.VehicleType == nil:
		score += 5
		reasons = append(reasons, "any-vehicle")
	}

	switch {
	case c.ServiceLevel != nil && r.ServiceLevel != nil && eqFold(*c.ServiceLevel, *r.ServiceLevel):
		score += 15
		reasons = append(reasons, "exact-service-level")
	case c.ServiceLevel == nil:
		score += 3
		reasons = append(reasons, "any-service-level")
	}

	return score, strings.Join(reasons, "+")
}

// IsActiveOn reports whether a contract applies on the given date: ACTIVE
// status and the date within [effective_from, effective_to] (date-only
// comparison, both bounds inclusive, either bound optional).
func IsActiveOn(c Candidate, date time.Time) bool {
	if c.Status != "ACTIVE" {
		return false
	}
	d := dayOnly(date)
	if c.EffectiveFrom != nil && d.Before(dayOnly(*c.EffectiveFrom)) {
		return false
	}
	if c.EffectiveTo != nil && d.After(dayOnly(*c.EffectiveTo)) {
		return false
	}
	return true
}

// PriceInput bundles everything ComputePrice needs: the contract's flat
// base_rate (also the fallback when a quantity-based basis can't price), an
// optional RateBasis (per-km / per-kg / breakpoints), the fuel-surcharge and
// min-charge terms, and the shipment quantities a basis prices against.
type PriceInput struct {
	BaseRate   float64
	RateBasis  *RateBasis
	FuelPct    *float64
	MinCharge  *float64
	DistanceKm *float64
	WeightKg   *float64
}

// ComputePrice derives the line-haul base — flat, or via the rate basis — then
// applies the fuel surcharge and the min-charge floor, rounding money to 2 dp.
// Mirrors computePrice in the TS, extended with the rate-basis dimension.
//
// When a per-km/per-kg basis can't price (missing or zero quantity), it falls
// back to the flat base_rate and records that in RateBasisNote, so the miss is
// visible in the quote audit rather than silently producing a 0 base.
func ComputePrice(in PriceInput) PricedQuote {
	base := max0(in.BaseRate)
	rateMode := string(RateFlat)
	basisApplied := false
	var rateQty, ratePerUnit float64
	rateNote := ""

	if in.RateBasis != nil && in.RateBasis.Mode != "" && in.RateBasis.Mode != RateFlat {
		rateMode = string(in.RateBasis.Mode)
		res := in.RateBasis.Evaluate(in.DistanceKm, in.WeightKg)
		if res.Applied {
			base = res.Base
			basisApplied = true
			rateQty = res.Quantity
			ratePerUnit = res.RatePerUnit
			rateNote = res.Note
		} else {
			rateNote = res.Note + " → using flat base_rate " + numStr(base)
		}
	}

	pct := 0.0
	if in.FuelPct != nil {
		pct = max0(*in.FuelPct)
	}
	fuelAmt := round2(base * pct / 100)
	subtotal := round2(base + fuelAmt)
	mc := 0.0
	if in.MinCharge != nil {
		mc = max0(*in.MinCharge)
	}
	total := subtotal
	if mc > total {
		total = mc
	}
	return PricedQuote{
		BaseRate:            base,
		FuelSurchargePct:    pct,
		FuelSurchargeAmount: fuelAmt,
		MinCharge:           mc,
		MinChargeApplied:    total > subtotal,
		Subtotal:            subtotal,
		Total:               round2(total),
		RateMode:            rateMode,
		RateBasisApplied:    basisApplied,
		RateQuantity:        rateQty,
		RatePerUnit:         ratePerUnit,
		RateBasisNote:       rateNote,
	}
}

// Quote runs the full pipeline over a candidate list: drop out-of-window and
// wrong-customer contracts, score the rest, and price the winner. The caller
// is responsible for having already filtered candidates to the matching lane
// and tenant (the DB query does that, scoped by auth.WithTenant).
//
// A contract locked to a specific customer only applies when that customer
// is the requester; when the request carries no customer, all
// customer-locked contracts are excluded so an operator preview never
// applies someone else's private rate.
func Quote(candidates []Candidate, r Request) Result {
	empty := func(reason Reason) Result {
		return Result{Matched: false, Reason: reason, Currency: DefaultCurrency, Alternates: []Alternate{}}
	}

	if len(candidates) == 0 {
		return empty(ReasonNoLaneMatch)
	}

	eligible := make([]Candidate, 0, len(candidates))
	for _, c := range candidates {
		if !IsActiveOn(c, r.ShipmentDate) {
			continue
		}
		// customer gate: keep generic (nil) or same-customer contracts only
		if c.CustomerID != nil && !eqPtr(r.CustomerID, c.CustomerID) {
			continue
		}
		eligible = append(eligible, c)
	}
	if len(eligible) == 0 {
		return empty(ReasonNoActiveContract)
	}

	type scored struct {
		c     Candidate
		score int
		why   string
	}
	ranked := make([]scored, 0, len(eligible))
	for _, c := range eligible {
		s, why := ScoreContract(c, r)
		ranked = append(ranked, scored{c, s, why})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		// Tie-break: most recently created wins so corrections take effect.
		return ranked[i].c.CreatedAt.After(ranked[j].c.CreatedAt)
	})

	win := ranked[0]
	price := ComputePrice(PriceInput{
		BaseRate:   win.c.BaseRate,
		RateBasis:  win.c.RateBasis,
		FuelPct:    win.c.FuelSurchargePct,
		MinCharge:  win.c.MinCharge,
		DistanceKm: r.DistanceKm,
		WeightKg:   r.WeightKg,
	})

	currency := win.c.Currency
	if currency == "" {
		currency = DefaultCurrency
	}

	alts := make([]Alternate, 0, 5)
	for i := 1; i < len(ranked) && i <= 5; i++ {
		alts = append(alts, Alternate{
			ContractID: ranked[i].c.ID,
			ContractNo: ranked[i].c.ContractNo,
			Score:      ranked[i].score,
			Why:        ranked[i].why,
		})
	}

	id, no := win.c.ID, win.c.ContractNo
	return Result{
		Matched:          true,
		Reason:           ReasonMatched,
		ContractID:       &id,
		ContractNo:       &no,
		CustomerID:       win.c.CustomerID,
		CarrierID:        win.c.CarrierID,
		Currency:         currency,
		PricedQuote:      price,
		AccessorialRules: win.c.AccessorialRules,
		Alternates:       alts,
	}
}

// SpotEstimate produces a NON-contracted indicative quote — perKmRate ×
// DistanceKm, with the optional min-charge floor — for a lane that Quote could
// not price from any contract. It is the graceful alternative to dead-ending on
// ReasonNoLaneMatch / ReasonNoActiveContract: the operator always sees a number.
//
// Crucially it is NOT a contract match: Matched is false, ContractID/No are nil,
// Estimate is true, and Reason is ReasonSpotEstimate. Keeping Matched false means
// rate-coverage analytics still count the shipment as uncontracted, so the gap
// the rate team needs to close stays visible — the estimate informs the operator
// without masking the missing contract.
//
// Returns ok=false (and a zero Result) when it can't price — a non-positive
// perKmRate or a missing/non-positive DistanceKm — so the caller can fall back
// to the original no-match result unchanged.
func SpotEstimate(r Request, perKmRate float64, minCharge *float64) (Result, bool) {
	if perKmRate <= 0 || r.DistanceKm == nil || *r.DistanceKm <= 0 {
		return Result{}, false
	}
	// Reuse the per-km rate basis so the spot math is identical to a per_km
	// contract — distance×rate, then the shared fuel/min-charge pipeline.
	price := ComputePrice(PriceInput{
		RateBasis:  &RateBasis{Mode: RatePerKm, RatePerUnit: perKmRate},
		MinCharge:  minCharge,
		DistanceKm: r.DistanceKm,
	})
	if !price.RateBasisApplied {
		// Defensive: the basis didn't price (shouldn't happen given the guards).
		return Result{}, false
	}
	return Result{
		Matched:     false,
		Reason:      ReasonSpotEstimate,
		Estimate:    true,
		Currency:    DefaultCurrency,
		PricedQuote: price,
		Alternates:  []Alternate{},
	}, true
}

// ── helpers ──────────────────────────────────────────────────────────────

func eqPtr(a, b *string) bool {
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}

func eqFold(a, b string) bool { return strings.EqualFold(a, b) }

func max0(n float64) float64 {
	if n < 0 {
		return 0
	}
	return n
}

func round2(n float64) float64 {
	// match Math.round(n*100)/100 — round half away from zero
	if n < 0 {
		return -round2(-n)
	}
	return float64(int64(n*100+0.5)) / 100
}

func dayOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

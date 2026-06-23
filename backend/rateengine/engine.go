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
}

// PricedQuote is the price breakdown for a single contract.
type PricedQuote struct {
	BaseRate            float64 `json:"baseRate"`
	FuelSurchargePct    float64 `json:"fuelSurchargePct"`
	FuelSurchargeAmount float64 `json:"fuelSurchargeAmount"`
	MinCharge           float64 `json:"minCharge"`
	MinChargeApplied    bool    `json:"minChargeApplied"`
	Subtotal            float64 `json:"subtotal"`
	Total               float64 `json:"total"`
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
)

// DefaultCurrency mirrors the TS DEFAULT_CURRENCY.
const DefaultCurrency = "AED"

// Result is the full quote response.
type Result struct {
	Matched bool   `json:"matched"`
	Reason  Reason `json:"reason"`

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

// ComputePrice applies the base + fuel-surcharge + min-charge-floor formula,
// rounding money to 2 dp. Mirrors computePrice in the TS.
func ComputePrice(baseRate float64, fuelPct, minCharge *float64) PricedQuote {
	base := max0(baseRate)
	pct := 0.0
	if fuelPct != nil {
		pct = max0(*fuelPct)
	}
	fuelAmt := round2(base * pct / 100)
	subtotal := round2(base + fuelAmt)
	mc := 0.0
	if minCharge != nil {
		mc = max0(*minCharge)
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
	price := ComputePrice(win.c.BaseRate, win.c.FuelSurchargePct, win.c.MinCharge)

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

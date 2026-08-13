// Package accessorial is the Go port of src/lib/logistics/accessorial-engine.ts
// (the pure evaluator half, above the DB divider). It interprets the
// auto_apply_rule JSONB blob on each logistics_accessorial_catalog entry and
// decides, for a given shipment context, whether the charge applies and at
// what amount.
//
// Like rateengine, this package is intentionally pure: no DB, no gin, no
// fleet360-backend/models import. The caller (handlers/logistics_accessorial.go)
// loads the tenant-scoped catalog, maps each row to a CatalogEntry, runs
// ApplyAccessorialCatalog, and persists the results as freight_charges rows.
// Keeping the evaluator pure mirrors the TS split and keeps these tests fast
// and free of DB cold-starts.
//
// Parity notes vs the TS source:
//   - EvaluateRule NEVER panics — a malformed rule becomes a non-applying
//     verdict so one bad catalog row can't take down shipment creation.
//   - round2 uses math.Round(n*100)/100. Accessorial amounts are always
//     max(0, …) so this matches JS Math.round (half away from zero) exactly.
//   - The taxable-resolution rule (rule-level `taxable` overrides the catalog
//     column ONLY when the rule blob actually carries a `taxable` key) is
//     preserved via Rule.Taxable being a *bool: nil = key absent.
package accessorial

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// ── Rule schema ──────────────────────────────────────────────────────────────

// RuleType is the discriminator on the auto_apply_rule blob.
type RuleType string

const (
	RuleFlat       RuleType = "flat"
	RulePercentage RuleType = "percentage"
	RulePerKm      RuleType = "per_km"
	RulePerKg      RuleType = "per_kg"
	RulePerStop    RuleType = "per_stop"
)

// PercentageBasis selects which shipment number a percentage rule applies to.
type PercentageBasis string

const (
	BasisBaseRate   PercentageBasis = "base_rate"
	BasisCargoValue PercentageBasis = "cargo_value"
	BasisSubtotal   PercentageBasis = "subtotal"
)

// Conditions is the optional gate on a rule. Every field is optional; an empty
// Conditions means "always applies". Populated fields are AND-ed. Pointer /
// slice zero-values stand in for the TS `!= null` / `?.length` presence checks.
type Conditions struct {
	MinDistanceKm *float64
	MaxDistanceKm *float64
	MinWeightKg   *float64
	MaxWeightKg   *float64
	MinStops      *float64
	// VehicleTypes / ShipmentTypes: if non-empty, the context value
	// (case-insensitive) must be in the list.
	VehicleTypes  []string
	ShipmentTypes []string
	// Requires* fire only when explicitly true in the blob (=== true in TS),
	// hence *bool rather than bool.
	RequiresHazmat      *bool
	RequiresCustoms     *bool
	RequiresCrossBorder *bool
}

// Rule is the union of all five rule variants flattened into one struct. Only
// the fields relevant to Type are populated by ParseRule; the rest stay zero.
type Rule struct {
	Type       RuleType
	Conditions *Conditions
	// Taxable: nil = the blob omitted the `taxable` key (use catalog default);
	// non-nil = the key was present, value resolved as (raw !== false).
	Taxable  *bool
	Currency *string

	Amount       float64         // flat
	Basis        PercentageBasis // percentage
	Percentage   float64         // percentage
	Rate         float64         // per_km / per_kg / per_stop
	FreeKm       *float64        // per_km
	MaxKm        *float64        // per_km
	FreeKg       *float64        // per_kg
	ExcludeFirst bool            // per_stop
}

// ── Context ──────────────────────────────────────────────────────────────────

// Context is the snapshot of the shipment the rule is evaluated against. Built
// by the handler about to create the shipment, from the order row (+ any quote
// it has). Nullable numbers are pointers so an absent datum reads as nil (the
// TS `?? 0` / `?? null` fallbacks live in the evaluator, not here).
type Context struct {
	BaseRate           *float64
	Subtotal           *float64
	CargoValue         *float64
	DistanceKm         *float64
	WeightKg           *float64
	StopsCount         *float64
	VehicleType        *string
	ShipmentType       *string
	IsHazmat           bool
	RequiresCustoms    bool
	OriginCountry      *string
	DestinationCountry *string
}

// ── Verdict ──────────────────────────────────────────────────────────────────

// Verdict is the result of evaluating a single rule. Amount is always 0 when
// Applies is false, and always rounded to 2dp when Applies is true.
type Verdict struct {
	Applies  bool
	Amount   float64
	Currency *string
	Taxable  bool
	Reason   string
}

func noApply(reason string, currency *string) Verdict {
	return Verdict{Applies: false, Amount: 0, Currency: currency, Taxable: false, Reason: reason}
}

// ── Conditions check ─────────────────────────────────────────────────────────

// ConditionsHold returns (true, "") when every populated predicate is satisfied,
// or (false, reason) on the first that fails. Reason strings mirror the TS for
// audit/operator-UI parity. (The TS "exceeds max" reasons interpolate the raw
// ctx value rather than the ?? 0 fallback; since those branches only fire when
// the value is a real number, using the deref-with-0 form here is equivalent.)
func ConditionsHold(cond *Conditions, ctx Context) (bool, string) {
	if cond == nil {
		return true, ""
	}
	if cond.MinDistanceKm != nil && n0(ctx.DistanceKm) < *cond.MinDistanceKm {
		return false, fmt.Sprintf("distance %skm below min %s", numStr(n0(ctx.DistanceKm)), numStr(*cond.MinDistanceKm))
	}
	if cond.MaxDistanceKm != nil && n0(ctx.DistanceKm) > *cond.MaxDistanceKm {
		return false, fmt.Sprintf("distance %skm exceeds max %s", numStr(n0(ctx.DistanceKm)), numStr(*cond.MaxDistanceKm))
	}
	if cond.MinWeightKg != nil && n0(ctx.WeightKg) < *cond.MinWeightKg {
		return false, fmt.Sprintf("weight %skg below min %s", numStr(n0(ctx.WeightKg)), numStr(*cond.MinWeightKg))
	}
	if cond.MaxWeightKg != nil && n0(ctx.WeightKg) > *cond.MaxWeightKg {
		return false, fmt.Sprintf("weight %skg exceeds max %s", numStr(n0(ctx.WeightKg)), numStr(*cond.MaxWeightKg))
	}
	if cond.MinStops != nil && n0(ctx.StopsCount) < *cond.MinStops {
		return false, fmt.Sprintf("stops %s below min %s", numStr(n0(ctx.StopsCount)), numStr(*cond.MinStops))
	}
	if len(cond.VehicleTypes) > 0 {
		v := strings.ToUpper(s0(ctx.VehicleType))
		if !containsFold(cond.VehicleTypes, v) {
			return false, fmt.Sprintf("vehicle %q not in [%s]", s0(ctx.VehicleType), strings.Join(cond.VehicleTypes, ","))
		}
	}
	if len(cond.ShipmentTypes) > 0 {
		s := strings.ToUpper(s0(ctx.ShipmentType))
		if !containsFold(cond.ShipmentTypes, s) {
			return false, fmt.Sprintf("shipment type %q not in [%s]", s0(ctx.ShipmentType), strings.Join(cond.ShipmentTypes, ","))
		}
	}
	if cond.RequiresHazmat != nil && *cond.RequiresHazmat && !ctx.IsHazmat {
		return false, "shipment is not hazmat"
	}
	if cond.RequiresCustoms != nil && *cond.RequiresCustoms && !ctx.RequiresCustoms {
		return false, "customs not required"
	}
	if cond.RequiresCrossBorder != nil && *cond.RequiresCrossBorder {
		o := strings.ToUpper(s0(ctx.OriginCountry))
		d := strings.ToUpper(s0(ctx.DestinationCountry))
		if o == "" || d == "" || o == d {
			return false, "not a cross-border shipment"
		}
	}
	return true, ""
}

// ── Parse ────────────────────────────────────────────────────────────────────

// ParseRule validates an unknown JSONB blob (the catalog's auto_apply_rule,
// decoded by GORM's json serializer to a map[string]any) into a usable Rule.
// Returns nil when the blob is missing, lacks a string `type`, or omits the
// numeric field its type requires — the caller treats nil as "no auto-apply
// rule, skip this catalog entry".
func ParseRule(raw map[string]any) *Rule {
	if raw == nil {
		return nil
	}
	typeStr, ok := asString(raw["type"])
	if !ok {
		return nil
	}
	rule := &Rule{Type: RuleType(typeStr)}

	if cm, ok := raw["conditions"].(map[string]any); ok {
		rule.Conditions = parseConditions(cm)
	}
	// Taxable: preserve "key present?" (for the override decision) and the
	// JS truthiness (raw !== false → taxable true).
	if tv, present := raw["taxable"]; present {
		b := true
		if bb, ok := tv.(bool); ok && !bb {
			b = false
		}
		rule.Taxable = &b
	}
	if cv, ok := asString(raw["currency"]); ok {
		rule.Currency = &cv
	}

	switch rule.Type {
	case RuleFlat:
		a, ok := asFloat(raw["amount"])
		if !ok {
			return nil
		}
		rule.Amount = a
	case RulePercentage:
		p, ok := asFloat(raw["percentage"])
		if !ok {
			return nil
		}
		basis, _ := asString(raw["basis"])
		if basis != string(BasisBaseRate) && basis != string(BasisCargoValue) && basis != string(BasisSubtotal) {
			return nil
		}
		rule.Percentage = p
		rule.Basis = PercentageBasis(basis)
	case RulePerKm:
		r, ok := asFloat(raw["rate"])
		if !ok {
			return nil
		}
		rule.Rate = r
		if v, ok := asFloat(raw["freeKm"]); ok {
			rule.FreeKm = &v
		}
		if v, ok := asFloat(raw["maxKm"]); ok {
			rule.MaxKm = &v
		}
	case RulePerKg:
		r, ok := asFloat(raw["rate"])
		if !ok {
			return nil
		}
		rule.Rate = r
		if v, ok := asFloat(raw["freeKg"]); ok {
			rule.FreeKg = &v
		}
	case RulePerStop:
		r, ok := asFloat(raw["rate"])
		if !ok {
			return nil
		}
		rule.Rate = r
		if b, ok := raw["excludeFirst"].(bool); ok {
			rule.ExcludeFirst = b
		}
	default:
		return nil
	}
	return rule
}

// parseConditions tolerantly extracts the gate from a conditions sub-object.
// Like the TS, it never invalidates the rule — unknown/garbage fields are
// ignored and read defensively at evaluation time.
func parseConditions(c map[string]any) *Conditions {
	cond := &Conditions{}
	if v, ok := asFloat(c["minDistanceKm"]); ok {
		cond.MinDistanceKm = &v
	}
	if v, ok := asFloat(c["maxDistanceKm"]); ok {
		cond.MaxDistanceKm = &v
	}
	if v, ok := asFloat(c["minWeightKg"]); ok {
		cond.MinWeightKg = &v
	}
	if v, ok := asFloat(c["maxWeightKg"]); ok {
		cond.MaxWeightKg = &v
	}
	if v, ok := asFloat(c["minStops"]); ok {
		cond.MinStops = &v
	}
	cond.VehicleTypes = asStringSlice(c["vehicleTypes"])
	cond.ShipmentTypes = asStringSlice(c["shipmentTypes"])
	if v, ok := asBool(c["requiresHazmat"]); ok {
		cond.RequiresHazmat = &v
	}
	if v, ok := asBool(c["requiresCustoms"]); ok {
		cond.RequiresCustoms = &v
	}
	if v, ok := asBool(c["requiresCrossBorder"]); ok {
		cond.RequiresCrossBorder = &v
	}
	return cond
}

// ── Evaluate ─────────────────────────────────────────────────────────────────

// EvaluateRule evaluates a single parsed rule against the context. It never
// panics: an unsatisfied gate, an unavailable basis, or a zero amount all
// produce a non-applying verdict.
func EvaluateRule(rule *Rule, ctx Context) Verdict {
	if ok, reason := ConditionsHold(rule.Conditions, ctx); !ok {
		return noApply(reason, rule.Currency)
	}

	taxable := rule.Taxable == nil || *rule.Taxable
	currency := rule.Currency

	var amount float64
	var reason string

	switch rule.Type {
	case RuleFlat:
		amount = rule.Amount
		reason = "flat " + numStr(rule.Amount)

	case RulePercentage:
		basisValue := pickBasis(rule.Basis, ctx)
		if basisValue == nil {
			return noApply(fmt.Sprintf("basis %q not available on shipment", string(rule.Basis)), currency)
		}
		amount = *basisValue * rule.Percentage / 100
		reason = fmt.Sprintf("%s%% of %s=%s", numStr(rule.Percentage), string(rule.Basis), numStr(*basisValue))

	case RulePerKm:
		dist := n0(ctx.DistanceKm)
		free := n0(rule.FreeKm)
		chargeable := math.Max(0, dist-free)
		capped := chargeable
		if rule.MaxKm != nil {
			capped = math.Min(chargeable, *rule.MaxKm-free)
		}
		amount = math.Max(0, capped) * rule.Rate
		capStr := ""
		if rule.MaxKm != nil && *rule.MaxKm != 0 {
			capStr = ", cap=" + numStr(*rule.MaxKm)
		}
		reason = fmt.Sprintf("%s/km × %skm (dist=%s, free=%s%s)",
			numStr(rule.Rate), numStr(math.Max(0, capped)), numStr(dist), numStr(free), capStr)

	case RulePerKg:
		wt := n0(ctx.WeightKg)
		chargeable := math.Max(0, wt-n0(rule.FreeKg))
		amount = chargeable * rule.Rate
		reason = fmt.Sprintf("%s/kg × %skg", numStr(rule.Rate), numStr(chargeable))

	case RulePerStop:
		stops := n0(ctx.StopsCount)
		chargeable := stops
		if rule.ExcludeFirst {
			chargeable = math.Max(0, stops-1)
		}
		amount = chargeable * rule.Rate
		reason = fmt.Sprintf("%s/stop × %s stops", numStr(rule.Rate), numStr(chargeable))

	default:
		return noApply("unknown rule type", currency)
	}

	amount = round2(math.Max(0, amount))
	if amount == 0 {
		return noApply(reason+" → amount 0", currency)
	}
	return Verdict{Applies: true, Amount: amount, Currency: currency, Taxable: taxable, Reason: reason}
}

func pickBasis(basis PercentageBasis, ctx Context) *float64 {
	switch basis {
	case BasisBaseRate:
		return ctx.BaseRate
	case BasisCargoValue:
		return ctx.CargoValue
	case BasisSubtotal:
		return ctx.Subtotal
	}
	return nil
}

// ── Catalog batch ────────────────────────────────────────────────────────────

// CatalogEntry is the pure-package view of one logistics_accessorial_catalog
// row. The handler maps models.LogisticsAccessorialCatalog → CatalogEntry,
// exactly as the TS maps the domain shape → CatalogEntry.
type CatalogEntry struct {
	ID            string
	Code          string
	Name          string
	ChargeType    string
	DefaultAmount *float64
	Currency      string
	Taxable       bool
	AutoApplyRule map[string]any
	Status        string
}

// AppliedAccessorial is one auto-applied charge: the computed amount plus the
// human-readable reason for audit metadata.
type AppliedAccessorial struct {
	CatalogID  string
	Code       string
	Name       string
	ChargeType string
	Amount     float64
	Currency   string
	Taxable    bool
	Reason     string
}

// ApplyAccessorialCatalog evaluates every catalog entry against the context and
// returns the list that should be auto-applied. Filters: status != "ACTIVE",
// missing/unparseable auto_apply_rule, and applies=false verdicts are skipped.
//
// Taxable resolution mirrors the TS: the rule-level `taxable` overrides the
// catalog row's column ONLY when the rule blob carried a `taxable` key (i.e.
// Rule.Taxable != nil). Otherwise the catalog's column is the default — so a
// CUSTOMS row stored taxable=false stays tax-exempt even when the rule omits it.
func ApplyAccessorialCatalog(catalog []CatalogEntry, ctx Context) []AppliedAccessorial {
	applied := make([]AppliedAccessorial, 0, len(catalog))
	for _, entry := range catalog {
		if entry.Status != "ACTIVE" {
			continue
		}
		rule := ParseRule(entry.AutoApplyRule)
		if rule == nil {
			continue
		}
		verdict := EvaluateRule(rule, ctx)
		if !verdict.Applies {
			continue
		}

		finalTaxable := entry.Taxable
		if rule.Taxable != nil {
			finalTaxable = verdict.Taxable
		}

		currency := entry.Currency
		if verdict.Currency != nil {
			currency = *verdict.Currency
		}
		if currency == "" {
			currency = "AED"
		}

		applied = append(applied, AppliedAccessorial{
			CatalogID:  entry.ID,
			Code:       entry.Code,
			Name:       entry.Name,
			ChargeType: entry.ChargeType,
			Amount:     verdict.Amount,
			Currency:   currency,
			Taxable:    finalTaxable,
			Reason:     verdict.Reason,
		})
	}
	return applied
}

// ── helpers ──────────────────────────────────────────────────────────────────

func round2(n float64) float64 { return math.Round(n*100) / 100 }

// numStr formats a float the way JS template interpolation would (480 → "480",
// 480.5 → "480.5"), for byte-parity with the TS reason strings.
func numStr(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

func n0(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func s0(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func asString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func asBool(v any) (bool, bool) {
	b, ok := v.(bool)
	return b, ok
}

// asFloat accepts the float64 GORM's JSON serializer produces, plus int/json
// variants defensively (a future UseNumber decode or hand-built map).
func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func asStringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := e.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func containsFold(list []string, upper string) bool {
	for _, t := range list {
		if strings.ToUpper(t) == upper {
			return true
		}
	}
	return false
}

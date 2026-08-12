package rateengine

// Rate basis — the quantity-based pricing dimension layered on top of the flat
// base_rate. A contract can price its line-haul base as:
//
//   - flat    base_rate is the whole base (today's behavior; the default)
//   - per_km  ratePerUnit × shipment distance (km)
//   - per_kg  ratePerUnit × shipment weight (kg)
//
// and either per_km or per_kg may carry a tiered rate table (breakpoints) so a
// longer/heavier move earns a different unit rate — the freight-industry
// "distance break" / "weight break". The biggest capability gap in the engine
// was that every contract priced flat; this closes it.
//
// Schema note: logistics_rate_contracts has no rate_basis column and Go
// AutoMigrate is disabled (Prisma/domain.ts owns the schema). So the basis
// rides in the contract's metadata JSONB under `rateBasis`, the same
// JSONB-driven pattern the accessorial engine uses for auto_apply_rule. This
// keeps the dimension additive — no migration, no schema ownership change.

import (
	"fmt"
	"strconv"
	"strings"
)

// RateMode is how a contract derives its line-haul base.
type RateMode string

const (
	RateFlat  RateMode = "flat"
	RatePerKm RateMode = "per_km"
	RatePerKg RateMode = "per_kg"
)

// RateBasisMetadataKey is the key under a rate contract's metadata JSONB that
// holds the basis blob.
const RateBasisMetadataKey = "rateBasis"

// Breakpoint is one tier in a stepped rate table. A shipment whose quantity
// (km or kg, per the basis mode) reaches MinQuantity falls into this tier; the
// engine selects the tier with the greatest MinQuantity the quantity reaches.
// A tier prices either as FlatAmount (a fixed charge for the bracket) or
// RatePerUnit (multiplied by the quantity); FlatAmount wins when both are set.
//
// Semantics are bracket-rate, not marginal: the selected tier's rate applies
// to the WHOLE quantity (standard LTL weight-break behavior), not just the
// portion above the breakpoint. Marginal/cumulative tiering can be added later
// as a separate mode if a contract ever needs it.
type Breakpoint struct {
	MinQuantity float64
	RatePerUnit *float64
	FlatAmount  *float64
}

// RateBasis is a contract's quantity-based pricing rule.
type RateBasis struct {
	Mode RateMode
	// RatePerUnit is the rate used when no breakpoint matches (the floor tier).
	RatePerUnit float64
	Breakpoints []Breakpoint
}

// RateBasisResult is the outcome of evaluating a basis against a shipment.
type RateBasisResult struct {
	Applied     bool    // false → caller falls back to the flat base_rate
	Base        float64 // computed line-haul base (rounded to 2dp)
	Mode        RateMode
	Quantity    float64 // the km or kg used
	RatePerUnit float64 // effective per-unit rate (0 for a flat-amount tier)
	Note        string
}

// quantityFor returns the shipment quantity this basis prices against, plus a
// human label for audit notes. Returns nil for flat/unknown modes.
func (b *RateBasis) quantityFor(distanceKm, weightKg *float64) (*float64, string) {
	switch b.Mode {
	case RatePerKm:
		return distanceKm, "distance (km)"
	case RatePerKg:
		return weightKg, "weight (kg)"
	default:
		return nil, ""
	}
}

// Evaluate computes the base charge for the basis given the shipment
// quantities. It never panics and returns Applied=false (Base 0) whenever it
// can't price — flat/unknown mode, a missing or zero quantity, or a computed
// base of 0 — so the caller can safely fall back to the contract's flat
// base_rate and record why.
func (b *RateBasis) Evaluate(distanceKm, weightKg *float64) RateBasisResult {
	if b == nil || b.Mode == "" || b.Mode == RateFlat {
		return RateBasisResult{Applied: false, Mode: RateFlat}
	}

	qtyPtr, unitLabel := b.quantityFor(distanceKm, weightKg)
	if qtyPtr == nil {
		label := unitLabel
		if label == "" {
			label = "a quantity"
		}
		return RateBasisResult{Applied: false, Mode: b.Mode,
			Note: fmt.Sprintf("%s basis needs %s but the shipment carries none", b.Mode, label)}
	}
	q := max0(*qtyPtr)
	if q == 0 {
		return RateBasisResult{Applied: false, Mode: b.Mode,
			Note: fmt.Sprintf("%s basis %s is zero", b.Mode, unitLabel)}
	}

	bp := b.selectBreakpoint(q)

	var base, effPerUnit float64
	var note string
	switch {
	case bp != nil && bp.FlatAmount != nil:
		base = round2(max0(*bp.FlatAmount))
		effPerUnit = 0
		note = fmt.Sprintf("%s flat tier @ min %s → %s", b.Mode, numStr(bp.MinQuantity), numStr(base))
	default:
		rate := max0(b.RatePerUnit)
		tierNote := ""
		if bp != nil && bp.RatePerUnit != nil {
			rate = max0(*bp.RatePerUnit)
			tierNote = fmt.Sprintf(" (tier min %s)", numStr(bp.MinQuantity))
		}
		effPerUnit = rate
		base = round2(rate * q)
		note = fmt.Sprintf("%s @ %s/unit%s × %s = %s", b.Mode, numStr(rate), tierNote, numStr(q), numStr(base))
	}

	if base <= 0 {
		return RateBasisResult{Applied: false, Mode: b.Mode, Quantity: q,
			Note: fmt.Sprintf("%s basis computed a base of 0", b.Mode)}
	}

	return RateBasisResult{
		Applied:     true,
		Base:        base,
		Mode:        b.Mode,
		Quantity:    q,
		RatePerUnit: effPerUnit,
		Note:        note,
	}
}

// selectBreakpoint returns the tier with the greatest MinQuantity the quantity
// reaches, or nil when no tier applies (quantity below every threshold, or no
// breakpoints at all). Sort-independent — it scans for the max qualifying
// MinQuantity, so callers needn't pre-sort.
func (b *RateBasis) selectBreakpoint(q float64) *Breakpoint {
	var chosen *Breakpoint
	for i := range b.Breakpoints {
		bp := &b.Breakpoints[i]
		if bp.MinQuantity <= q && (chosen == nil || bp.MinQuantity > chosen.MinQuantity) {
			chosen = bp
		}
	}
	return chosen
}

// ParseRateBasis extracts a RateBasis from a rate contract's metadata JSONB.
// Returns nil for absent/flat/garbage input — both mean "price the flat
// base_rate", so the engine treats a nil basis and a flat basis identically.
// Tolerant by design: malformed tiers are skipped, not fatal, mirroring the
// accessorial engine's ParseRule.
func ParseRateBasis(metadata map[string]any) *RateBasis {
	if metadata == nil {
		return nil
	}
	raw, ok := metadata[RateBasisMetadataKey].(map[string]any)
	if !ok {
		return nil
	}

	mode := normalizeRateMode(asStringVal(raw["mode"]))
	if mode == RateFlat {
		return nil // flat == use base_rate; no basis object needed
	}

	b := &RateBasis{Mode: mode, RatePerUnit: asFloatVal(raw["ratePerUnit"])}

	if arr, ok := raw["breakpoints"].([]any); ok {
		for _, item := range arr {
			m, ok := item.(map[string]any)
			if !ok {
				continue
			}
			bp := Breakpoint{MinQuantity: asFloatVal(m["minQuantity"])}
			if v, present := m["ratePerUnit"]; present {
				f := asFloatVal(v)
				bp.RatePerUnit = &f
			}
			if v, present := m["flatAmount"]; present {
				f := asFloatVal(v)
				bp.FlatAmount = &f
			}
			b.Breakpoints = append(b.Breakpoints, bp)
		}
	}
	return b
}

// normalizeRateMode maps a free-form mode string to a RateMode, accepting a few
// spellings operators might author. Anything unrecognized (including the empty
// string) is treated as flat.
func normalizeRateMode(s string) RateMode {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "per_km", "perkm", "per-km", "km", "distance":
		return RatePerKm
	case "per_kg", "perkg", "per-kg", "kg", "weight":
		return RatePerKg
	default:
		return RateFlat
	}
}

// ── JSONB scalar coercion ──────────────────────────────────────────────────
// GORM's serializer:json decodes numbers to float64 and strings to string, but
// hand-authored blobs (or other writers) may use ints or numeric strings —
// coerce defensively rather than panic on a type assertion.

func asStringVal(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func asFloatVal(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f
	default:
		return 0
	}
}

// numStr formats a float without trailing zeros for readable audit notes.
func numStr(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }

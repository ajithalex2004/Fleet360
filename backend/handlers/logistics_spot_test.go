package handlers

import "testing"

func spotFp(f float64) *float64 { return &f }
func spotSp(s string) *string   { return &s }

func TestSpotEnvKey(t *testing.T) {
	cases := map[string]string{
		"REEFER":      "REEFER",
		"Reefer":      "REEFER",
		"3-Ton":       "3_TON",
		" box truck ": "BOX_TRUCK",
		"40ft-HC":     "40FT_HC",
		"":            "",
		"---":         "",
	}
	for in, want := range cases {
		if got := spotEnvKey(in); got != want {
			t.Errorf("spotEnvKey(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolveSpotPerKmRate(t *testing.T) {
	t.Run("request override wins over env", func(t *testing.T) {
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE", "1.8")
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE_REEFER", "2.5")
		if got := resolveSpotPerKmRate(spotFp(5), spotSp("REEFER")); got != 5 {
			t.Fatalf("override = %v, want 5", got)
		}
	})

	t.Run("per-vehicle env beats global", func(t *testing.T) {
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE", "1.8")
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE_REEFER", "2.5")
		if got := resolveSpotPerKmRate(nil, spotSp("Reefer")); got != 2.5 {
			t.Fatalf("per-vehicle = %v, want 2.5", got)
		}
	})

	t.Run("falls back to global env", func(t *testing.T) {
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE", "1.8")
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE_FLATBED", "")
		if got := resolveSpotPerKmRate(nil, spotSp("FLATBED")); got != 1.8 {
			t.Fatalf("global = %v, want 1.8", got)
		}
	})

	t.Run("no config → 0 (fallback stays inert)", func(t *testing.T) {
		t.Setenv("LOGISTICS_SPOT_PER_KM_RATE", "")
		if got := resolveSpotPerKmRate(nil, spotSp("REEFER")); got != 0 {
			t.Fatalf("unset = %v, want 0", got)
		}
		// non-positive override is ignored too
		if got := resolveSpotPerKmRate(spotFp(0), nil); got != 0 {
			t.Fatalf("zero override = %v, want 0", got)
		}
	})
}

package distmatrix

import (
	"io"
	"math"
	"net/http"
	"strings"
	"testing"

	"fleet360-backend/geo"
)

// Two close Dubai points used across the haversine tests.
var (
	p0 = geo.LatLng{Latitude: 25.2048, Longitude: 55.2708}
	p1 = geo.LatLng{Latitude: 25.1972, Longitude: 55.2797}
)

func TestCompute_Empty(t *testing.T) {
	r, err := Compute(nil, Options{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r.Distances) != 0 || len(r.Durations) != 0 {
		t.Fatalf("expected empty matrices, got %v / %v", r.Distances, r.Durations)
	}
	if r.Provider != "haversine" {
		t.Fatalf("expected default provider haversine, got %q", r.Provider)
	}
}

func TestCompute_SinglePoint(t *testing.T) {
	r, err := Compute([]geo.LatLng{p0}, Options{Provider: "haversine"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r.Distances) != 1 || len(r.Distances[0]) != 1 || r.Distances[0][0] != 0 {
		t.Fatalf("expected 1x1 zero distances, got %v", r.Distances)
	}
	if r.Durations[0][0] != 0 {
		t.Fatalf("expected 1x1 zero durations, got %v", r.Durations)
	}
}

func TestCompute_HaversineSymmetricAndExact(t *testing.T) {
	r, err := Compute([]geo.LatLng{p0, p1}, Options{Provider: "haversine"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Provider != "haversine" {
		t.Fatalf("provider = %q, want haversine", r.Provider)
	}
	// Diagonal is zero.
	if r.Distances[0][0] != 0 || r.Distances[1][1] != 0 {
		t.Fatalf("diagonal not zero: %v", r.Distances)
	}
	// Symmetric.
	if r.Distances[0][1] != r.Distances[1][0] || r.Durations[0][1] != r.Durations[1][0] {
		t.Fatalf("matrix not symmetric: %v / %v", r.Distances, r.Durations)
	}
	// Exact pipeline (matches buildHaversineMatrix): distance = round2(raw),
	// duration = round1(raw/speed*60) where raw uses the UNrounded detoured km.
	rawKm := geo.HaversineKm(p0, p1) * defaultDetourFactor
	wantKm := round(rawKm, 2)
	wantMin := round((rawKm/defaultAvgSpeedKmh)*60, 1)
	if r.Distances[0][1] != wantKm {
		t.Fatalf("distance = %v, want %v", r.Distances[0][1], wantKm)
	}
	if r.Durations[0][1] != wantMin {
		t.Fatalf("duration = %v, want %v", r.Durations[0][1], wantMin)
	}
	// Sanity: these points are ~1km apart, so the detoured distance is small.
	if r.Distances[0][1] <= 0 || r.Distances[0][1] > 5 {
		t.Fatalf("distance %v outside plausible range for adjacent points", r.Distances[0][1])
	}
}

func TestCompute_DetourFactorOverride(t *testing.T) {
	base, _ := Compute([]geo.LatLng{p0, p1}, Options{Provider: "haversine"})
	doubled, _ := Compute([]geo.LatLng{p0, p1}, Options{Provider: "haversine", DetourFactor: defaultDetourFactor * 2})
	// Doubling the factor doubles the great-circle component (modulo rounding).
	if doubled.Distances[0][1] <= base.Distances[0][1] {
		t.Fatalf("expected larger distance with doubled detour factor: base=%v doubled=%v",
			base.Distances[0][1], doubled.Distances[0][1])
	}
}

func TestCompute_AutoFallsBackToHaversineWithoutToken(t *testing.T) {
	r, err := Compute([]geo.LatLng{p0, p1}, Options{}) // no provider, no token → haversine
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Provider != "haversine" {
		t.Fatalf("provider = %q, want haversine", r.Provider)
	}
}

func TestCompute_MapboxRequiresToken(t *testing.T) {
	_, err := Compute([]geo.LatLng{p0, p1}, Options{Provider: "mapbox"})
	if err == nil {
		t.Fatal("expected error when provider=mapbox and no token, got nil")
	}
}

func TestCompute_MapboxParsesAndConverts(t *testing.T) {
	// Canned 2×2 Mapbox reply: metres + seconds, with one null (unroutable)
	// cell that must become +Inf.
	const canned = `{
	  "code": "Ok",
	  "distances": [[0, 1234.5], [1234.5, 0]],
	  "durations": [[0, 123.6], [null, 0]]
	}`
	orig := fetchURL
	fetchURL = func(url string) (*http.Response, error) {
		if !strings.Contains(url, "tok123") {
			t.Errorf("token not threaded into URL: %s", url)
		}
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(canned)),
		}, nil
	}
	defer func() { fetchURL = orig }()

	r, err := Compute([]geo.LatLng{p0, p1}, Options{Provider: "mapbox", MapboxToken: "tok123"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if r.Provider != "mapbox" {
		t.Fatalf("provider = %q, want mapbox", r.Provider)
	}
	if r.Distances[0][1] != 1.23 { // 1234.5m → 1.2345km → round2 1.23
		t.Fatalf("distance[0][1] = %v, want 1.23", r.Distances[0][1])
	}
	if r.Durations[0][1] != 2.1 { // 123.6s → 2.06min → round1 2.1
		t.Fatalf("duration[0][1] = %v, want 2.1", r.Durations[0][1])
	}
	if !math.IsInf(r.Durations[1][0], 1) { // null → +Inf
		t.Fatalf("duration[1][0] = %v, want +Inf", r.Durations[1][0])
	}
}

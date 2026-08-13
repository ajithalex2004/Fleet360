// Package distmatrix is the Go port of src/lib/logistics/distance-matrix.ts.
//
// Given N points (lat/lng pairs) it returns an N×N matrix of road distances
// (km) and durations (min) for the VRP solver (package routeopt). The solver
// reads this matrix exclusively — it never sees raw lat/lng or vendor shapes.
//
// Two providers, identical to the TS original:
//   - "haversine" — pure math, no network. distance = great-circle × detour
//     factor (default 1.3×), duration estimated at 60 km/h. Used when no Mapbox
//     token is configured or the caller explicitly requests offline mode.
//   - "mapbox"    — Mapbox Matrix API: real road network + traffic-aware
//     durations. Default when a token is present. The 25-points-per-call limit
//     is handled transparently by chunking into source/destination windows.
//
// Network access goes through the package var fetchURL so tests can inject a
// stub (the Go equivalent of the TS _setFetchForTests seam) without importing
// net/http machinery into the test. The haversine path is the only one that
// runs without a token, so it is the one that production exercises today; the
// Mapbox path is ported for parity and is covered by an injected-fetch test.
package distmatrix

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"

	"fleet360-backend/geo"
)

const (
	mapboxBase          = "https://api.mapbox.com/directions-matrix/v1/mapbox/driving"
	mapboxChunkLimit    = 25  // Mapbox per-call point limit
	defaultDetourFactor = 1.3 // haversine multiplier — calibrated for GCC urban+highway
	defaultAvgSpeedKmh  = 60  // haversine duration estimate
)

// Options mirrors the TS MatrixOptions plus the Mapbox token (the TS reads it
// from process.env; the Go package takes it as input so it stays env-free and
// unit-testable — the handler passes os.Getenv("MAPBOX_TOKEN")).
type Options struct {
	// Provider is "", "haversine", or "mapbox". "" auto-selects: Mapbox when a
	// token is supplied, haversine otherwise.
	Provider string
	// DetourFactor multiplies the haversine distance. 0 → default 1.3. Ignored
	// for provider "mapbox".
	DetourFactor float64
	// AvgSpeedKmh is the haversine duration estimate speed. 0 → default 60.
	AvgSpeedKmh float64
	// MapboxToken is the Mapbox access token. Empty disables the Mapbox path.
	MapboxToken string
}

// Result is the matrix the solver consumes. distances[i][j] is km from point i
// to point j; durations[i][j] is minutes. provider records which backend built
// it ("haversine" | "mapbox").
type Result struct {
	Distances [][]float64 `json:"distances"`
	Durations [][]float64 `json:"durations"`
	Provider  string      `json:"provider"`
}

// fetchURL is the network seam. Tests replace it with a stub; production uses
// http.Get. Kept unexported — same-package test files set it directly.
var fetchURL = func(url string) (*http.Response, error) { return http.Get(url) }

// ── Public API ───────────────────────────────────────────────────────────────

// Compute builds an N×N distance + duration matrix for the given points.
//
// Provider selection (verbatim from computeDistanceMatrix):
//   - opts.Provider == "haversine" → force haversine, no network
//   - opts.Provider == "mapbox"    → require a token, error if absent
//   - "" → use Mapbox when a token is supplied, else fall back to haversine
func Compute(points []geo.LatLng, opts Options) (Result, error) {
	provider := opts.Provider
	if provider == "" {
		provider = "haversine"
	}

	// Degenerate matrices mirror the TS exactly: 0 points → empty, 1 point →
	// a 1×1 of zeros. provider echoes opts.Provider (defaulted to haversine).
	if len(points) == 0 {
		return Result{Distances: [][]float64{}, Durations: [][]float64{}, Provider: provider}, nil
	}
	if len(points) == 1 {
		return Result{Distances: [][]float64{{0}}, Durations: [][]float64{{0}}, Provider: provider}, nil
	}

	switch opts.Provider {
	case "haversine":
		return buildHaversineMatrix(points, opts), nil
	case "mapbox":
		if opts.MapboxToken == "" {
			return Result{}, fmt.Errorf(`MAPBOX_TOKEN not configured but provider="mapbox" was requested`)
		}
		return buildMapboxMatrix(points, opts.MapboxToken)
	default:
		// Auto: prefer Mapbox, fall back silently to haversine if no token —
		// dev environments work out of the box; production should set a token.
		if opts.MapboxToken != "" {
			return buildMapboxMatrix(points, opts.MapboxToken)
		}
		return buildHaversineMatrix(points, opts), nil
	}
}

// ── Haversine ────────────────────────────────────────────────────────────────

func buildHaversineMatrix(points []geo.LatLng, opts Options) Result {
	factor := opts.DetourFactor
	if factor == 0 {
		factor = defaultDetourFactor
	}
	speed := opts.AvgSpeedKmh
	if speed == 0 {
		speed = defaultAvgSpeedKmh
	}
	n := len(points)
	distances := newMatrix(n, 0)
	durations := newMatrix(n, 0)
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			km := geo.HaversineKm(points[i], points[j]) * factor
			min := (km / speed) * 60
			d := round(km, 2)
			t := round(min, 1)
			distances[i][j], distances[j][i] = d, d
			durations[i][j], durations[j][i] = t, t
		}
	}
	return Result{Distances: distances, Durations: durations, Provider: "haversine"}
}

// ── Mapbox ───────────────────────────────────────────────────────────────────

// mapboxResponse models the Matrix API reply. distances are metres, durations
// seconds; null cells (unroutable pairs) become +Inf, matching the TS Infinity.
type mapboxResponse struct {
	Code      string       `json:"code"`
	Distances [][]*float64 `json:"distances"`
	Durations [][]*float64 `json:"durations"`
}

// buildMapboxMatrix issues a single call for ≤25 points, otherwise stitches the
// full square from source/destination chunks — the same strategy as the TS.
func buildMapboxMatrix(points []geo.LatLng, token string) (Result, error) {
	n := len(points)
	if n <= mapboxChunkLimit {
		dist, dur, err := callMapboxMatrix(points, token)
		if err != nil {
			return Result{}, err
		}
		return Result{Distances: dist, Durations: dur, Provider: "mapbox"}, nil
	}

	distances := newMatrix(n, math.Inf(1))
	durations := newMatrix(n, math.Inf(1))
	coords := coordList(points)
	for srcStart := 0; srcStart < n; srcStart += mapboxChunkLimit {
		for dstStart := 0; dstStart < n; dstStart += mapboxChunkLimit {
			sources := rangeIdx(srcStart, min(srcStart+mapboxChunkLimit, n))
			destinations := rangeIdx(dstStart, min(dstStart+mapboxChunkLimit, n))
			url := fmt.Sprintf("%s/%s?annotations=distance,duration&sources=%s&destinations=%s&access_token=%s",
				mapboxBase, coords, joinIdx(sources), joinIdx(destinations), token)
			body, err := getMapbox(url, "Mapbox matrix chunk")
			if err != nil {
				return Result{}, err
			}
			for i := 0; i < len(sources); i++ {
				for j := 0; j < len(destinations); j++ {
					distances[sources[i]][destinations[j]] = metresToKm(body.Distances[i][j])
					durations[sources[i]][destinations[j]] = secondsToMin(body.Durations[i][j])
				}
			}
		}
	}
	return Result{Distances: distances, Durations: durations, Provider: "mapbox"}, nil
}

// callMapboxMatrix is one Mapbox Matrix call. Caller guarantees ≤25 points.
func callMapboxMatrix(points []geo.LatLng, token string) ([][]float64, [][]float64, error) {
	if len(points) > mapboxChunkLimit {
		return nil, nil, fmt.Errorf("callMapboxMatrix expects ≤%d points, got %d", mapboxChunkLimit, len(points))
	}
	url := fmt.Sprintf("%s/%s?annotations=distance,duration&access_token=%s", mapboxBase, coordList(points), token)
	body, err := getMapbox(url, "Mapbox matrix")
	if err != nil {
		return nil, nil, err
	}
	distancesKm := make([][]float64, len(body.Distances))
	for i, row := range body.Distances {
		distancesKm[i] = make([]float64, len(row))
		for j, v := range row {
			distancesKm[i][j] = metresToKm(v)
		}
	}
	durationsMin := make([][]float64, len(body.Durations))
	for i, row := range body.Durations {
		durationsMin[i] = make([]float64, len(row))
		for j, v := range row {
			durationsMin[i][j] = secondsToMin(v)
		}
	}
	return distancesKm, durationsMin, nil
}

// getMapbox performs the GET, surfaces a non-2xx as an error (with the body
// text, like the TS), and validates that distances/durations are present.
func getMapbox(url, label string) (*mapboxResponse, error) {
	res, err := fetchURL(url)
	if err != nil {
		return nil, fmt.Errorf("%s request failed: %w", label, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("%s failed: %d %s", label, res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var body mapboxResponse
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, fmt.Errorf("%s response unparseable: %w", label, err)
	}
	if body.Distances == nil || body.Durations == nil {
		return nil, fmt.Errorf("%s response missing distances/durations: code=%s", label, body.Code)
	}
	return &body, nil
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func metresToKm(v *float64) float64 {
	if v == nil {
		return math.Inf(1)
	}
	return round(*v/1000, 2)
}

func secondsToMin(v *float64) float64 {
	if v == nil {
		return math.Inf(1)
	}
	return round(*v/60, 1)
}

func coordList(points []geo.LatLng) string {
	parts := make([]string, len(points))
	for i, p := range points {
		parts[i] = fmt.Sprintf("%v,%v", p.Longitude, p.Latitude)
	}
	return strings.Join(parts, ";")
}

func rangeIdx(start, endExclusive int) []int {
	out := make([]int, 0, endExclusive-start)
	for i := start; i < endExclusive; i++ {
		out = append(out, i)
	}
	return out
}

func joinIdx(idx []int) string {
	parts := make([]string, len(idx))
	for i, v := range idx {
		parts[i] = fmt.Sprintf("%d", v)
	}
	return strings.Join(parts, ";")
}

func newMatrix(n int, fill float64) [][]float64 {
	m := make([][]float64, n)
	for i := range m {
		m[i] = make([]float64, n)
		if fill != 0 {
			for j := range m[i] {
				m[i][j] = fill
			}
		}
	}
	return m
}

// round matches the TS round(n, places) = Math.round(n*f)/f. math.Round is
// half-away-from-zero, which equals JS half-up for the non-negative distances
// and durations this package produces.
func round(n float64, places int) float64 {
	f := math.Pow(10, float64(places))
	return math.Round(n*f) / f
}

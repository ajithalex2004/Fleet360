package handlers

// Logistics geocoder (Phase L4c) — the Go port of src/lib/logistics/geocoder.ts.
//
// Forward-geocodes a free-text address to lat/lng, tenant-scoped through a
// persistent cache (logistics_geocode_cache) so each address costs at most one
// Mapbox call per tenant. Lives in the handlers package — not a pure package —
// because it needs database.DB and auth.WithTenant(c); the planner service
// (logistics_planner.go) calls geocodeAddress for any stop missing coordinates.
//
// Production reality (verbatim from the TS): with MAPBOX_TOKEN unset, a
// cache-miss raises a no_token error rather than calling the network. The
// planner turns that into a per-stop geocodeFailure and drops the shipment —
// it never fails the whole optimize run.
//
// The Mapbox call goes through the package var geocodeFetchURL so a test can
// inject a stub without real network (the same seam distmatrix.fetchURL uses).

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const mapboxGeocodeBase = "https://api.mapbox.com/geocoding/v5/mapbox.places"

// geocodeFetchURL is the network seam. Tests replace it; production uses
// http.Get. Kept unexported — same-package test files set it directly.
var geocodeFetchURL = func(u string) (*http.Response, error) { return http.Get(u) }

// geocodeResult is one resolved coordinate. confidence is the Mapbox relevance
// (0 when unknown, e.g. a cache row with a NULL confidence).
type geocodeResult struct {
	latitude   float64
	longitude  float64
	confidence float64
}

// geocodeErr mirrors the TS GeocodeError: a typed failure the planner inspects
// only for its message (it records the message as the failure reason). kind is
// "no_token" | "no_match" | "api_error".
type geocodeErr struct {
	kind string
	msg  string
}

func (e *geocodeErr) Error() string { return e.msg }

// ── normalisation ────────────────────────────────────────────────────────────

var (
	// geoPunct strips the same characters as the TS regex /[.,;'"`()]/g.
	geoPunct = regexp.MustCompile("[.,;'\"`()]")
	geoWS    = regexp.MustCompile(`\s+`)
)

// normaliseAddress lower-cases, strips punctuation, and collapses whitespace —
// the cache key. Byte-for-byte the TS normaliseAddress.
func normaliseAddress(raw string) string {
	s := strings.ToLower(raw)
	s = geoPunct.ReplaceAllString(s, " ")
	s = geoWS.ReplaceAllString(s, " ")
	return strings.TrimSpace(s)
}

// ── cache ────────────────────────────────────────────────────────────────────

// readGeocodeCache returns a cached hit for the normalised address, tenant
// scoped. Like the TS readCache it is best-effort: any query error is treated
// as a miss (returns ok=false) rather than failing the geocode.
func readGeocodeCache(c *gin.Context, normalised string) (geocodeResult, bool) {
	var row models.LogisticsGeocodeCache
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("normalised_address = ?", normalised).
		Limit(1).Find(&row).Error; err != nil {
		return geocodeResult{}, false
	}
	if row.ID == "" {
		return geocodeResult{}, false
	}
	conf := 0.0
	if row.Confidence != nil {
		conf = *row.Confidence
	}
	return geocodeResult{latitude: row.Latitude, longitude: row.Longitude, confidence: conf}, true
}

// writeGeocodeCache upserts a resolved coordinate, keyed by
// (tenant_id, normalised_address). Best-effort: a write failure is swallowed
// (the caller already has its answer), matching the TS writeCache's catch.
func writeGeocodeCache(c *gin.Context, tid, normalised string, res geocodeResult) {
	conf := res.confidence
	row := models.LogisticsGeocodeCache{
		TenantID:          tid,
		NormalisedAddress: normalised,
		Latitude:          res.latitude,
		Longitude:         res.longitude,
		Confidence:        &conf,
		Source:            "mapbox",
	}
	database.DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "tenant_id"}, {Name: "normalised_address"}},
		DoUpdates: clause.Assignments(map[string]any{
			"latitude":     res.latitude,
			"longitude":    res.longitude,
			"confidence":   res.confidence,
			"refreshed_at": gorm.Expr("NOW()"),
		}),
	}).Create(&row)
}

// ── Mapbox forward geocode ───────────────────────────────────────────────────

type mapboxGeoFeature struct {
	Center    []float64 `json:"center"` // [lng, lat]
	Relevance float64   `json:"relevance"`
}

type mapboxGeoResponse struct {
	Features []mapboxGeoFeature `json:"features"`
}

// callMapboxGeocode issues a single forward-geocode call. Mirrors the TS
// callMapbox: types=address,place,poi, limit=1, center=[lng,lat], confidence =
// relevance ?? 0; a non-2xx is an api_error, an empty/short feature is no_match.
func callMapboxGeocode(address, token string) (geocodeResult, error) {
	endpoint := fmt.Sprintf("%s/%s.json?access_token=%s&limit=1&types=address,place,poi",
		mapboxGeocodeBase, url.PathEscape(address), token)
	res, err := geocodeFetchURL(endpoint)
	if err != nil {
		return geocodeResult{}, &geocodeErr{kind: "api_error", msg: fmt.Sprintf("Mapbox geocode request failed: %v", err)}
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return geocodeResult{}, &geocodeErr{kind: "api_error", msg: fmt.Sprintf("Mapbox geocode failed: %d %s", res.StatusCode, strings.TrimSpace(string(raw)))}
	}
	var body mapboxGeoResponse
	if err := json.Unmarshal(raw, &body); err != nil {
		return geocodeResult{}, &geocodeErr{kind: "api_error", msg: fmt.Sprintf("Mapbox geocode response unparseable: %v", err)}
	}
	if len(body.Features) == 0 || len(body.Features[0].Center) != 2 {
		return geocodeResult{}, &geocodeErr{kind: "no_match", msg: fmt.Sprintf("No geocode match for %q", address)}
	}
	f := body.Features[0]
	return geocodeResult{latitude: f.Center[1], longitude: f.Center[0], confidence: f.Relevance}, nil
}

// ── public entry ─────────────────────────────────────────────────────────────

// geocodeAddress resolves a free-text address to coordinates for the given
// tenant. Order, verbatim from the TS geocode(): empty → no_match; cache hit →
// return; no token → no_token (never hits the network); else Mapbox → cache →
// return. Returns a *geocodeErr the planner records as a stop failure reason.
func geocodeAddress(c *gin.Context, tid, rawAddress string) (geocodeResult, error) {
	if strings.TrimSpace(rawAddress) == "" {
		return geocodeResult{}, &geocodeErr{kind: "no_match", msg: "Empty address"}
	}
	normalised := normaliseAddress(rawAddress)
	if hit, ok := readGeocodeCache(c, normalised); ok {
		return hit, nil
	}
	token := os.Getenv("MAPBOX_TOKEN")
	if token == "" {
		return geocodeResult{}, &geocodeErr{
			kind: "no_token",
			msg:  fmt.Sprintf("MAPBOX_TOKEN not configured and %q not in cache", rawAddress),
		}
	}
	res, err := callMapboxGeocode(rawAddress, token)
	if err != nil {
		return geocodeResult{}, err
	}
	writeGeocodeCache(c, tid, normalised, res)
	return res, nil
}

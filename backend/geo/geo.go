// Package geo holds the shared great-circle primitives used by the logistics
// execution layer — the Go port of the bits of src/lib/logistics/distance-matrix.ts
// that the ETA predictor and geofence evaluator both depend on.
//
// Kept deliberately tiny and dependency-free so both the etapredict and
// geofence packages can import it without pulling in a distance-matrix/Mapbox
// stack they don't need.
package geo

import "math"

// LatLng is a WGS84 coordinate. Mirrors the TS LatLng.
type LatLng struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

// earthRadiusKm matches distance-matrix.ts EARTH_RADIUS_KM.
const earthRadiusKm = 6371.0

func toRad(deg float64) float64 { return deg * math.Pi / 180 }

// HaversineKm is the great-circle distance between two points in kilometres.
// Identical formula to haversineKm in distance-matrix.ts, including the
// asin(min(1, sqrt(h))) clamp that guards against tiny floating-point
// overshoot pushing the argument past 1.
func HaversineKm(a, b LatLng) float64 {
	dLat := toRad(b.Latitude - a.Latitude)
	dLng := toRad(b.Longitude - a.Longitude)
	lat1 := toRad(a.Latitude)
	lat2 := toRad(b.Latitude)
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKm * math.Asin(math.Min(1, math.Sqrt(h)))
}

package geo

import (
	"math"
	"testing"
)

func TestHaversineKm(t *testing.T) {
	t.Run("zero distance for identical points", func(t *testing.T) {
		p := LatLng{Latitude: 25.2048, Longitude: 55.2708} // Dubai
		if d := HaversineKm(p, p); d != 0 {
			t.Fatalf("expected 0, got %v", d)
		}
	})

	t.Run("Dubai to Abu Dhabi is ~120-140km", func(t *testing.T) {
		dubai := LatLng{Latitude: 25.2048, Longitude: 55.2708}
		abuDhabi := LatLng{Latitude: 24.4539, Longitude: 54.3773}
		d := HaversineKm(dubai, abuDhabi)
		if d < 120 || d > 140 {
			t.Fatalf("expected ~120-140km, got %v", d)
		}
	})

	t.Run("symmetric", func(t *testing.T) {
		a := LatLng{Latitude: 25.0, Longitude: 55.0}
		b := LatLng{Latitude: 24.0, Longitude: 54.0}
		if math.Abs(HaversineKm(a, b)-HaversineKm(b, a)) > 1e-9 {
			t.Fatal("haversine should be symmetric")
		}
	})

	t.Run("one degree of latitude is ~111km", func(t *testing.T) {
		a := LatLng{Latitude: 0, Longitude: 0}
		b := LatLng{Latitude: 1, Longitude: 0}
		d := HaversineKm(a, b)
		if d < 111 || d > 112 {
			t.Fatalf("expected ~111km, got %v", d)
		}
	})
}

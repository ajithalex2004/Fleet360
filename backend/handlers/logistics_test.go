package handlers

import (
	"reflect"
	"testing"
	"time"
)

// splitCSV backs the ?status= allow-list filter on GetLogisticsShipments.
// It must trim surrounding spaces and drop empty segments so a sloppy query
// string like "DRAFT, ,ACTIVE," doesn't produce empty IN-list members that
// would silently never match.
func TestSplitCSV(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"empty", "", []string{}},
		{"single", "DRAFT", []string{"DRAFT"}},
		{"spaced", "DRAFT, DISPATCHED ,ACTIVE", []string{"DRAFT", "DISPATCHED", "ACTIVE"}},
		{"trailing comma", "DRAFT,", []string{"DRAFT"}},
		{"only commas and spaces", " , , ", []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := splitCSV(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("splitCSV(%q) = %#v, want %#v", tc.in, got, tc.want)
			}
		})
	}
}

// parseShipmentDate feeds the rate-quote engine's effective-date gating. It
// must accept a bare ISO date and a full RFC3339 timestamp (normalising both
// to midnight UTC, since the engine compares date-only), default to today when
// omitted, and reject garbage so a malformed body becomes a 400 rather than a
// silent "today".
func TestParseShipmentDate(t *testing.T) {
	sp := func(s string) *string { return &s }

	t.Run("bare ISO date", func(t *testing.T) {
		got, err := parseShipmentDate(sp("2026-06-15"))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		want := time.Date(2026, time.June, 15, 0, 0, 0, 0, time.UTC)
		if !got.Equal(want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("RFC3339 timestamp normalises to midnight UTC", func(t *testing.T) {
		got, err := parseShipmentDate(sp("2026-06-15T13:45:00Z"))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if h := got.Hour(); h != 0 {
			t.Fatalf("expected midnight, got hour %d", h)
		}
		if got.Day() != 15 {
			t.Fatalf("expected day 15, got %d", got.Day())
		}
	})

	t.Run("nil defaults to today at midnight UTC", func(t *testing.T) {
		got, err := parseShipmentDate(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got.Hour() != 0 || got.Minute() != 0 || got.Location() != time.UTC {
			t.Fatalf("expected midnight UTC, got %v", got)
		}
	})

	t.Run("garbage is rejected", func(t *testing.T) {
		if _, err := parseShipmentDate(sp("not-a-date")); err == nil {
			t.Fatal("expected an error for malformed date")
		}
	})
}

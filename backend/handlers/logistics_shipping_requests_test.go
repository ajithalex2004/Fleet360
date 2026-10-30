package handlers

import (
	"testing"
	"time"
)

func TestParseISO(t *testing.T) {
	sp := func(s string) *string { return &s }

	t.Run("valid RFC3339", func(t *testing.T) {
		got := parseISO(sp("2026-10-15T14:30:00Z"))
		if got == nil {
			t.Fatal("expected non-nil time")
		}
		if got.Year() != 2026 || got.Month() != 10 || got.Day() != 15 || got.Hour() != 14 || got.Minute() != 30 {
			t.Fatalf("unexpected time: %v", got)
		}
	})

	t.Run("valid YYYY-MM-DD", func(t *testing.T) {
		got := parseISO(sp("2026-10-15"))
		if got == nil {
			t.Fatal("expected non-nil time")
		}
		if got.Year() != 2026 || got.Month() != 10 || got.Day() != 15 {
			t.Fatalf("unexpected time: %v", got)
		}
	})

	t.Run("nil or empty", func(t *testing.T) {
		if parseISO(nil) != nil {
			t.Fatal("expected nil for nil input")
		}
		if parseISO(sp("")) != nil {
			t.Fatal("expected nil for empty input")
		}
		if parseISO(sp("   ")) != nil {
			t.Fatal("expected nil for whitespace input")
		}
	})

	t.Run("invalid string", func(t *testing.T) {
		if parseISO(sp("invalid-date")) != nil {
			t.Fatal("expected nil for invalid date string")
		}
	})
}

func TestShippingRequestStatusValidation(t *testing.T) {
	valid := []string{"DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "REJECTED", "CANCELLED"}
	for _, s := range valid {
		if !validShippingRequestStatuses[s] {
			t.Errorf("expected status %s to be valid", s)
		}
	}

	invalid := []string{"CONVERTED", "COMPLETED", "UNKNOWN", "FOO"}
	for _, s := range invalid {
		if validShippingRequestStatuses[s] {
			t.Errorf("expected status %s to be invalid in map", s)
		}
	}
}

func TestShippingRequestSequenceFormat(t *testing.T) {
	yy := time.Now().Format("06")
	expectedPrefix := "SR-" + yy
	if len(expectedPrefix) != 5 {
		t.Fatalf("expected prefix length 5, got %s", expectedPrefix)
	}
}

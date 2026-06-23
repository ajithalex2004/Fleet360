package corsorigin

import (
	"testing"
)

func resetCache() {
	c.mu.Lock()
	c.origins = map[string]struct{}{}
	c.mu.Unlock()
}

func TestParseList_StripsWhitespaceAndEmpties(t *testing.T) {
	got := parseList(" https://a.com , ,https://b.com ,, ")
	if len(got) != 2 {
		t.Fatalf("want 2 entries, got %d: %v", len(got), got)
	}
	if _, ok := got["https://a.com"]; !ok {
		t.Errorf("missing https://a.com")
	}
	if _, ok := got["https://b.com"]; !ok {
		t.Errorf("missing https://b.com")
	}
}

func TestParseList_Empty(t *testing.T) {
	if got := parseList(""); len(got) != 0 {
		t.Errorf("want empty set for empty input, got %v", got)
	}
}

func TestIsAllowed_EmptyOriginIsRejected(t *testing.T) {
	resetCache()
	c.mu.Lock()
	c.origins = map[string]struct{}{"https://a.com": {}}
	c.mu.Unlock()
	if IsAllowed("") {
		t.Error("empty origin should never be allowed")
	}
}

func TestIsAllowed_ExactMatchOnly(t *testing.T) {
	resetCache()
	c.mu.Lock()
	c.origins = map[string]struct{}{"https://fleet.client.com": {}}
	c.mu.Unlock()

	cases := []struct {
		origin string
		want   bool
	}{
		{"https://fleet.client.com", true},
		{"https://fleet.client.com/", false}, // trailing slash differs from Origin header form
		{"http://fleet.client.com", false},   // scheme matters
		{"https://other.client.com", false},  // subdomain matters
		{"", false},
	}
	for _, tc := range cases {
		if got := IsAllowed(tc.origin); got != tc.want {
			t.Errorf("IsAllowed(%q) = %v, want %v", tc.origin, got, tc.want)
		}
	}
}

func TestLoadBaseline_UnsetEnvLogsAndLoadsNothing(t *testing.T) {
	resetCache()
	t.Setenv(envVar, "")
	if n := LoadBaseline(); n != 0 {
		t.Errorf("want 0 origins loaded from unset env, got %d", n)
	}
	if got := Snapshot(); len(got) != 0 {
		t.Errorf("want empty snapshot, got %v", got)
	}
}

func TestLoadBaseline_ParsesCommaSeparated(t *testing.T) {
	resetCache()
	t.Setenv(envVar, "http://localhost:3000 , https://admin.fleet360.io")
	n := LoadBaseline()
	if n != 2 {
		t.Errorf("want 2 origins, got %d (snapshot=%v)", n, Snapshot())
	}
	if !IsAllowed("http://localhost:3000") {
		t.Error("localhost:3000 not allowed")
	}
	if !IsAllowed("https://admin.fleet360.io") {
		t.Error("admin.fleet360.io not allowed")
	}
}

func TestLoadBaseline_PreservesTenantEntries(t *testing.T) {
	// If a refresh goroutine populated tenant origins before LoadBaseline
	// runs (unlikely ordering, but defended for), they must survive.
	resetCache()
	c.mu.Lock()
	c.origins = map[string]struct{}{"https://tenant.example.com": {}}
	c.mu.Unlock()

	t.Setenv(envVar, "http://localhost:3000")
	LoadBaseline()

	if !IsAllowed("http://localhost:3000") {
		t.Error("env baseline lost")
	}
	if !IsAllowed("https://tenant.example.com") {
		t.Error("pre-existing tenant origin lost during baseline load")
	}
}

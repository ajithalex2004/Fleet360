package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCachingRevocationChecker_RevokesTokensIssuedBefore(t *testing.T) {
	revokedAt := time.Date(2026, 9, 29, 10, 0, 30, 500e6, time.UTC)
	c := &CachingRevocationChecker{
		NotBefore: func(context.Context, string, string) (time.Time, error) { return revokedAt, nil },
		Now:       func() time.Time { return revokedAt.Add(time.Second) },
	}
	cases := []struct {
		issued time.Time
		want   bool
	}{
		{revokedAt.Add(-time.Hour), true},
		{revokedAt.Add(-2 * time.Second), true},
		{revokedAt.Truncate(time.Second), false}, // same second: a sign-in right after the revocation
		{revokedAt.Add(time.Minute), false},
	}
	for _, tc := range cases {
		got, err := c.RevokedSince(context.Background(), "u", "t", tc.issued)
		if err != nil || got != tc.want {
			t.Errorf("issued %v: got %v, %v; want %v", tc.issued, got, err, tc.want)
		}
	}
}

func TestCachingRevocationChecker_NoRevocation(t *testing.T) {
	c := &CachingRevocationChecker{NotBefore: func(context.Context, string, string) (time.Time, error) { return time.Time{}, nil }}
	if got, _ := c.RevokedSince(context.Background(), "u", "t", time.Time{}); got {
		t.Fatal("revoked without a revocation")
	}
}

func TestCachingRevocationChecker_RechecksAfterInterval(t *testing.T) {
	now := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	calls := 0
	revoked := time.Time{}
	c := &CachingRevocationChecker{
		Recheck: time.Minute,
		Now:     func() time.Time { return now },
		NotBefore: func(context.Context, string, string) (time.Time, error) {
			calls++
			return revoked, nil
		},
	}
	issued := now.Add(-time.Hour)
	if got, _ := c.RevokedSince(context.Background(), "u", "t", issued); got {
		t.Fatal("not revoked yet")
	}
	revoked = now.Add(10 * time.Second) // revocation lands
	now = now.Add(30 * time.Second)
	if got, _ := c.RevokedSince(context.Background(), "u", "t", issued); got {
		t.Fatal("cached value should still apply within the recheck interval")
	}
	now = now.Add(31 * time.Second) // 61 s after the first read
	if got, _ := c.RevokedSince(context.Background(), "u", "t", issued); !got {
		t.Fatal("revocation must apply once the recheck interval has passed")
	}
	if calls != 2 {
		t.Fatalf("NotBefore called %d times, want 2", calls)
	}
}

func TestCachingRevocationChecker_ErrorKeepsLastKnownValue(t *testing.T) {
	now := time.Date(2026, 9, 29, 10, 0, 0, 0, time.UTC)
	fail := false
	c := &CachingRevocationChecker{
		Recheck: time.Second,
		Now:     func() time.Time { return now },
		NotBefore: func(context.Context, string, string) (time.Time, error) {
			if fail {
				return time.Time{}, errors.New("db down")
			}
			return now, nil
		},
	}
	issued := now.Add(-time.Hour)
	if got, _ := c.RevokedSince(context.Background(), "u", "t", issued); !got {
		t.Fatal("want revoked")
	}
	fail = true
	now = now.Add(time.Minute)
	got, err := c.RevokedSince(context.Background(), "u", "t", issued)
	if !got || err == nil {
		t.Fatalf("a failed recheck must keep the known revocation and report the error: got %v, %v", got, err)
	}
}

type fixedChecker struct{ revoked bool }

func (f fixedChecker) RevokedSince(context.Context, string, string, time.Time) (bool, error) {
	return f.revoked, nil
}

func TestMiddleware_RefusesRevokedTokens(t *testing.T) {
	t.Setenv("JWT_SECRET", testSecret)
	gin.SetMode(gin.TestMode)
	token, err := Issue("user-1", "tenant-1", "TENANT_ADMIN", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	run := func() int {
		r := gin.New()
		r.GET("/x", Middleware(), func(c *gin.Context) { c.Status(http.StatusOK) })
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		r.ServeHTTP(w, req)
		return w.Code
	}
	t.Cleanup(func() { SetRevocationChecker(nil) })

	SetRevocationChecker(fixedChecker{revoked: true})
	if code := run(); code != http.StatusUnauthorized {
		t.Fatalf("revoked token: got %d, want 401", code)
	}
	SetRevocationChecker(fixedChecker{revoked: false})
	if code := run(); code != http.StatusOK {
		t.Fatalf("valid token: got %d, want 200", code)
	}
}

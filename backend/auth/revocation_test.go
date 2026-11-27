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

func TestBuildTokenRevocationKeysAndFingerprint(t *testing.T) {
	// SHA-256("fleet360-test-token") matches Next.js tokenFingerprint().
	const sample = "fleet360-test-token"
	gotHash := TokenFingerprint(sample)
	if len(gotHash) != 64 {
		t.Fatalf("fingerprint length = %d, want 64", len(gotHash))
	}
	keys := BuildTokenRevocationKeys("11111111-1111-4111-8111-111111111111", gotHash)
	if len(keys) != 2 || keys[0] != "sid:11111111-1111-4111-8111-111111111111" || keys[1] != "tok:"+gotHash {
		t.Fatalf("unexpected keys: %#v", keys)
	}
	legacyKeys := BuildTokenRevocationKeys("", gotHash)
	if len(legacyKeys) != 1 || legacyKeys[0] != "tok:"+gotHash {
		t.Fatalf("unexpected legacy keys: %#v", legacyKeys)
	}
}

func TestMiddleware_PerTokenRevocationMultiDeviceAndFailClosedProduction(t *testing.T) {
	t.Setenv("JWT_SECRET", testSecret)
	gin.SetMode(gin.TestMode)

	const sidA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	const sidB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

	tokA, err := IssueWithID("user-1", "tenant-1", "TENANT_ADMIN", sidA, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	tokB, err := IssueWithID("user-1", "tenant-1", "TENANT_ADMIN", sidB, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	legacyTok, err := Issue("user-1", "tenant-1", "TENANT_ADMIN", time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	revokedKeys := map[string]bool{
		"sid:" + sidA:                        true,
		"tok:" + TokenFingerprint(legacyTok): true,
	}
	var dbErr error

	checker := &CachingRevocationChecker{
		NotBefore: func(context.Context, string, string) (time.Time, error) {
			return time.Time{}, dbErr
		},
		TokenRevoked: func(_ context.Context, _ string, keys []string) (bool, error) {
			if dbErr != nil {
				return false, dbErr
			}
			for _, k := range keys {
				if revokedKeys[k] {
					return true, nil
				}
			}
			return false, nil
		},
	}
	SetRevocationChecker(checker)
	t.Cleanup(func() { SetRevocationChecker(nil) })

	run := func(tok string) (int, string) {
		var gotSID string
		r := gin.New()
		r.GET("/x", Middleware(), func(c *gin.Context) {
			gotSID = SessionID(c)
			c.Status(http.StatusOK)
		})
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		r.ServeHTTP(w, req)
		return w.Code, gotSID
	}

	// 1. Single-device revocation: Device A (sidA) rejected immediately (401), Device B (sidB) still active (200)
	if code, _ := run(tokA); code != http.StatusUnauthorized {
		t.Fatalf("revoked device A token: got %d, want 401", code)
	}
	if code, gotSID := run(tokB); code != http.StatusOK || gotSID != sidB {
		t.Fatalf("active device B token: got status=%d sid=%q, want 200 %q", code, gotSID, sidB)
	}

	// 2. Legacy token without jti matched via SHA-256 tok:<hash>
	if code, _ := run(legacyTok); code != http.StatusUnauthorized {
		t.Fatalf("revoked legacy token: got %d, want 401", code)
	}

	// 3. DB error in GO_ENV=production MUST fail closed (401)
	dbErr = errors.New("postgres unavailable")
	t.Setenv("GO_ENV", "production")
	if code, _ := run(tokB); code != http.StatusUnauthorized {
		t.Fatalf("production DB revocation error: got %d, want 401 (fail closed)", code)
	}

	// 4. DB error outside production logs and allows (200)
	t.Setenv("GO_ENV", "development")
	if code, _ := run(tokB); code != http.StatusOK {
		t.Fatalf("development DB revocation error: got %d, want 200", code)
	}

	// 5. Same-second logout-all invalidates pre-revocation iat_ms token while allowing post-revocation token
	dbErr = nil
	tokBefore, err := IssueWithID("user-2", "tenant-1", "TENANT_ADMIN", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	notBeforeSameSec := time.Now()
	time.Sleep(5 * time.Millisecond)
	tokAfter, err := IssueWithID("user-2", "tenant-1", "TENANT_ADMIN", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	SetRevocationChecker(&CachingRevocationChecker{
		NotBefore: func(context.Context, string, string) (time.Time, error) {
			return notBeforeSameSec, nil
		},
	})
	if code, _ := run(tokBefore); code != http.StatusUnauthorized {
		t.Fatalf("same-second pre-revocation iat_ms token: got %d, want 401", code)
	}
	if code, _ := run(tokAfter); code != http.StatusOK {
		t.Fatalf("same-second post-revocation iat_ms token: got %d, want 200", code)
	}

	// 6. Nil revocation checker in GO_ENV=production MUST fail closed (401)
	SetRevocationChecker(nil)
	t.Setenv("GO_ENV", "production")
	if code, _ := run(tokAfter); code != http.StatusUnauthorized {
		t.Fatalf("production nil revocation checker: got %d, want 401 (fail closed)", code)
	}
}

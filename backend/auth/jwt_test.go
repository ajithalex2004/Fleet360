package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-at-least-16-chars-long!"

func setTestSecret(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", testSecret)
}

func TestIssue_ProducesParseableToken(t *testing.T) {
	setTestSecret(t)
	token, err := Issue("user-1", "tenant-1", "ADMIN", 0)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	claims, err := ParseAndValidate(token)
	if err != nil {
		t.Fatalf("ParseAndValidate: %v", err)
	}
	if claims.Subject != "user-1" {
		t.Errorf("sub mismatch: %q", claims.Subject)
	}
	if claims.TenantID != "tenant-1" {
		t.Errorf("tenant_id mismatch: %q", claims.TenantID)
	}
	if claims.Role != "ADMIN" {
		t.Errorf("role mismatch: %q", claims.Role)
	}
	if claims.Issuer != Issuer {
		t.Errorf("iss mismatch: %q", claims.Issuer)
	}
}

func TestParseAndValidate_RejectsMissingSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "")
	_, err := ParseAndValidate("anything")
	if err == nil || !strings.Contains(err.Error(), "JWT_SECRET") {
		t.Errorf("expected JWT_SECRET error, got: %v", err)
	}
}

func TestParseAndValidate_RejectsShortSecret(t *testing.T) {
	t.Setenv("JWT_SECRET", "too-short")
	_, err := ParseAndValidate("anything")
	if err == nil || !strings.Contains(err.Error(), "at least 16") {
		t.Errorf("expected short-secret error, got: %v", err)
	}
}

func TestParseAndValidate_RejectsAlgNone(t *testing.T) {
	setTestSecret(t)
	// Craft an unsigned ("alg=none") token. A correct validator must
	// refuse to honour it even though the JWT library can technically
	// decode it.
	claims := &Claims{
		TenantID:         "t1",
		Role:             "ADMIN",
		RegisteredClaims: jwt.RegisteredClaims{Issuer: Issuer, Subject: "u1", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("signing alg=none: %v", err)
	}
	if _, err := ParseAndValidate(s); err == nil {
		t.Error("alg=none token must be rejected")
	}
}

func TestParseAndValidate_RejectsWrongIssuer(t *testing.T) {
	setTestSecret(t)
	claims := &Claims{
		TenantID: "t1",
		Role:     "ADMIN",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "evil-service",
			Subject:   "u1",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing: %v", err)
	}
	if _, err := ParseAndValidate(s); err == nil {
		t.Error("token from wrong issuer must be rejected")
	}
}

func TestParseAndValidate_RejectsExpired(t *testing.T) {
	setTestSecret(t)
	claims := &Claims{
		TenantID: "t1",
		Role:     "ADMIN",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   "u1",
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := tok.SignedString([]byte(testSecret))
	if _, err := ParseAndValidate(s); err == nil {
		t.Error("expired token must be rejected")
	}
}

func TestParseAndValidate_RejectsMissingTenant(t *testing.T) {
	setTestSecret(t)
	claims := &Claims{
		Role: "ADMIN",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Subject:   "u1",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, _ := tok.SignedString([]byte(testSecret))
	if _, err := ParseAndValidate(s); err == nil {
		t.Error("token without tenant_id must be rejected")
	}
}

func TestExtractBearer(t *testing.T) {
	cases := []struct {
		header, want string
	}{
		{"Bearer abc.def.ghi", "abc.def.ghi"},
		{"Bearer  abc", "abc"},
		{"", ""},
		{"bearer abc", ""},          // case sensitive — RFC 6750 says "Bearer"
		{"Basic dXNlcjpwYXNz", ""},  // wrong scheme
		{"Bearer", ""},               // no token
	}
	for _, tc := range cases {
		if got := extractBearer(tc.header); got != tc.want {
			t.Errorf("extractBearer(%q) = %q, want %q", tc.header, got, tc.want)
		}
	}
}

func TestMiddleware_HappyPath(t *testing.T) {
	setTestSecret(t)
	tok, err := Issue("user-1", "tenant-1", "ADMIN", time.Hour)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/echo", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"user_id":   UserID(c),
			"tenant_id": TenantID(c),
			"role":      RoleCode(c),
		})
	})

	req := httptest.NewRequest(http.MethodGet, "/echo", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d (body=%s)", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, want := range []string{`"user_id":"user-1"`, `"tenant_id":"tenant-1"`, `"role":"ADMIN"`} {
		if !strings.Contains(body, want) {
			t.Errorf("response body missing %q: %s", want, body)
		}
	}
}

func TestMiddleware_MissingHeaderReturns401(t *testing.T) {
	setTestSecret(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/protected", func(c *gin.Context) { c.JSON(200, gin.H{}) })

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMiddleware_InvalidTokenReturns401(t *testing.T) {
	setTestSecret(t)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(Middleware())
	r.GET("/protected", func(c *gin.Context) { c.JSON(200, gin.H{}) })

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401 on garbage token, got %d", w.Code)
	}
}

func TestHelpers_ReturnEmptyForUnauthenticatedContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := &gin.Context{}
	if got := TenantID(c); got != "" {
		t.Errorf("TenantID without auth should return empty, got %q", got)
	}
	if got := UserID(c); got != "" {
		t.Errorf("UserID without auth should return empty, got %q", got)
	}
	if got := RoleCode(c); got != "" {
		t.Errorf("RoleCode without auth should return empty, got %q", got)
	}
}

package handlers

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestHealthz(t *testing.T) {
	r := gin.New()
	r.GET("/healthz", Healthz)

	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"status":"alive"`) {
		t.Fatalf("expected body to contain status alive, got %s", w.Body.String())
	}
}

func TestDebugPhasegate_FailClosedWhenUnset(t *testing.T) {
	origToken := os.Getenv("PHASEGATE_DEBUG_TOKEN")
	defer os.Setenv("PHASEGATE_DEBUG_TOKEN", origToken)
	os.Unsetenv("PHASEGATE_DEBUG_TOKEN")

	r := gin.New()
	r.GET("/debug/phasegate", DebugPhasegate)

	req := httptest.NewRequest("GET", "/debug/phasegate", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 when PHASEGATE_DEBUG_TOKEN is unset, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"error":"not found"`) {
		t.Fatalf("expected body to contain not found, got %s", w.Body.String())
	}
}

func TestDebugPhasegate_FailClosedWhenTokenMismatched(t *testing.T) {
	origToken := os.Getenv("PHASEGATE_DEBUG_TOKEN")
	defer os.Setenv("PHASEGATE_DEBUG_TOKEN", origToken)
	os.Setenv("PHASEGATE_DEBUG_TOKEN", "super-secret-operator-token-12345")

	r := gin.New()
	r.GET("/debug/phasegate", DebugPhasegate)

	// Missing header
	req1 := httptest.NewRequest("GET", "/debug/phasegate", nil)
	w1 := httptest.NewRecorder()
	r.ServeHTTP(w1, req1)
	if w1.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 when X-Debug-Token header is missing, got %d", w1.Code)
	}

	// Incorrect token
	req2 := httptest.NewRequest("GET", "/debug/phasegate", nil)
	req2.Header.Set("X-Debug-Token", "wrong-token")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 when X-Debug-Token is incorrect, got %d", w2.Code)
	}
}

func TestDebugPhasegate_SuccessWhenAuthorized(t *testing.T) {
	secret := "super-secret-operator-token-12345"
	origToken := os.Getenv("PHASEGATE_DEBUG_TOKEN")
	defer os.Setenv("PHASEGATE_DEBUG_TOKEN", origToken)
	os.Setenv("PHASEGATE_DEBUG_TOKEN", secret)

	r := gin.New()
	r.GET("/debug/phasegate", DebugPhasegate)

	req := httptest.NewRequest("GET", "/debug/phasegate", nil)
	req.Header.Set("X-Debug-Token", secret)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 when authorized, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"status"`) {
		t.Fatalf("expected body to contain status, got %s", w.Body.String())
	}
}

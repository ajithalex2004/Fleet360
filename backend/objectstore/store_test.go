package objectstore

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestDerivedKey_PathSeparatorsCannotEscapeDatePrefix(t *testing.T) {
	// In S3/MinIO, keys are flat strings — "../" is not a real directory
	// traversal. The actual safety property is that user-supplied path
	// separators ("/", "\") in the original filename get sanitised so the
	// caller can't slip an object outside the date-partitioned `uploads/`
	// prefix into a different bucket layout.
	ts := time.Date(2026, 6, 23, 10, 30, 0, 0, time.UTC)
	for _, attack := range []string{
		"../etc/passwd",
		"..\\..\\etc\\passwd",
		"/absolute/path.bin",
		"weird/sub\\path/name.txt",
	} {
		key := DerivedKey(attack, ts)
		if !strings.HasPrefix(key, "uploads/2026/06/23/") {
			t.Errorf("DerivedKey(%q) escaped the date prefix: %q", attack, key)
		}
		// Beyond the date prefix, no further "/" or "\" should appear —
		// the filename portion must be a single flat segment.
		suffix := strings.TrimPrefix(key, "uploads/2026/06/23/")
		if strings.ContainsAny(suffix, "/\\") {
			t.Errorf("DerivedKey(%q) leaked a path separator into the filename portion: %q", attack, key)
		}
	}
}

func TestDerivedKey_PreservesCommonChars(t *testing.T) {
	ts := time.Date(2026, 6, 23, 10, 30, 0, 0, time.UTC)
	key := DerivedKey("Annual_Report-Q2.2026.pdf", ts)
	// Date partition + suffix with the original name intact.
	if !strings.HasSuffix(key, "-Annual_Report-Q2.2026.pdf") {
		t.Errorf("safe chars not preserved: %q", key)
	}
}

func TestDerivedKey_HandlesUnicodeAndSpaces(t *testing.T) {
	ts := time.Date(2026, 6, 23, 10, 30, 0, 0, time.UTC)
	key := DerivedKey("invoice 2026 (final).pdf", ts)
	// spaces + parens become underscores — but the .pdf suffix and the
	// general shape stay intact so an operator can still identify the file.
	if !strings.HasSuffix(key, ".pdf") {
		t.Errorf("file extension lost: %q", key)
	}
	if strings.Contains(key, " ") || strings.Contains(key, "(") || strings.Contains(key, ")") {
		t.Errorf("special chars not stripped: %q", key)
	}
}

func TestDerivedKey_EmptyOriginalNameGetsPlaceholder(t *testing.T) {
	ts := time.Date(2026, 6, 23, 10, 30, 0, 0, time.UTC)
	key := DerivedKey("", ts)
	if !strings.HasSuffix(key, "-file") {
		t.Errorf("empty original name should fall back to 'file': %q", key)
	}
}

func TestDerivedKey_DatePartitioned(t *testing.T) {
	// Two uploads on the same day land under the same date prefix; uploads
	// on different days don't share a prefix. Ensures list-by-date works.
	day1 := time.Date(2026, 6, 23, 0, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 6, 24, 0, 0, 0, 0, time.UTC)
	a := DerivedKey("a.pdf", day1)
	b := DerivedKey("b.pdf", day1.Add(23*time.Hour))
	c := DerivedKey("c.pdf", day2)

	if a[:len("uploads/2026/06/23/")] != b[:len("uploads/2026/06/23/")] {
		t.Errorf("same-day uploads should share date prefix: %q vs %q", a, b)
	}
	if a[:len("uploads/2026/06/23/")] == c[:len("uploads/2026/06/23/")] {
		t.Errorf("different-day uploads should NOT share date prefix: %q vs %q", a, c)
	}
}

func TestDerivedKey_KeyPrefixIsolation(t *testing.T) {
	ts := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)

	t.Setenv("S3_KEY_PREFIX", "staging")
	stagingKey := DerivedKey("doc.pdf", ts)
	if !strings.HasPrefix(stagingKey, "staging/uploads/2026/09/14/") {
		t.Errorf("expected staging prefix, got %q", stagingKey)
	}

	t.Setenv("S3_KEY_PREFIX", "production")
	prodKey := DerivedKey("doc.pdf", ts)
	if !strings.HasPrefix(prodKey, "production/uploads/2026/09/14/") {
		t.Errorf("expected production prefix, got %q", prodKey)
	}
}

func TestInit_FailsOnMissingEnv(t *testing.T) {
	// All four required vars empty — Init must refuse loudly.
	t.Setenv("S3_ENDPOINT", "")
	t.Setenv("S3_ACCESS_KEY", "")
	t.Setenv("S3_SECRET_KEY", "")
	t.Setenv("S3_BUCKET", "")

	err := Init(context.Background())
	if err == nil {
		t.Fatal("Init must return an error when required env vars are missing")
	}
	if !strings.Contains(err.Error(), "S3_ENDPOINT") {
		t.Errorf("error should name the missing env vars: %v", err)
	}
}

func TestPut_FailsBeforeInit(t *testing.T) {
	// Reset the package singleton so this test is independent of test order.
	prev := pkgClient
	pkgClient = nil
	defer func() { pkgClient = prev }()

	err := Put(context.Background(), "any", strings.NewReader("hi"), 2, "text/plain")
	if err == nil || !strings.Contains(err.Error(), "not initialised") {
		t.Errorf("Put without Init should fail loudly, got: %v", err)
	}
}

func TestPresignedGetURL_FailsBeforeInit(t *testing.T) {
	prev := pkgClient
	pkgClient = nil
	defer func() { pkgClient = prev }()

	t.Setenv("S3_KEY_PREFIX", "")
	_, err := PresignedGetURL(context.Background(), "uploads/2026/01/01/1-file.pdf", 0)
	if err == nil || !strings.Contains(err.Error(), "not initialised") {
		t.Errorf("PresignedGetURL without Init should fail loudly, got: %v", err)
	}
}

func TestValidateKey_PathTraversal(t *testing.T) {
	t.Setenv("S3_KEY_PREFIX", "")
	for _, bad := range []string{
		"../uploads/file.pdf",
		"uploads/../../secret.env",
		"/uploads/file.pdf",
		"\\uploads\\file.pdf",
		"uploads//double-slash.pdf",
	} {
		if err := ValidateKey(bad, ""); err == nil {
			t.Errorf("expected error for path traversal %q, got nil", bad)
		}
	}
}

func TestValidateKey_EnvironmentPrefixEnforcement(t *testing.T) {
	t.Setenv("S3_KEY_PREFIX", "staging")

	// Valid staging key
	if err := ValidateKey("staging/uploads/2026/09/14/1-doc.pdf", ""); err != nil {
		t.Errorf("valid staging key failed: %v", err)
	}

	// Cross-environment key: production key on staging
	if err := ValidateKey("production/uploads/2026/09/14/1-doc.pdf", ""); err == nil {
		t.Errorf("expected rejection for cross-environment production key on staging, got nil")
	}

	// Legacy un-prefixed key on staging
	if err := ValidateKey("uploads/2026/09/14/1-doc.pdf", ""); err == nil {
		t.Errorf("expected rejection for unprefixed key when S3_KEY_PREFIX=staging, got nil")
	}
}

func TestValidateKey_TenantBoundaryEnforcement(t *testing.T) {
	t.Setenv("S3_KEY_PREFIX", "staging")

	tenantA := "tenant-alpha"
	tenantB := "tenant-bravo"

	keyA := "staging/uploads/tenant-alpha/2026/09/14/1-invoice.pdf"

	// Tenant A accessing Tenant A key -> OK
	if err := ValidateKey(keyA, tenantA); err != nil {
		t.Errorf("tenant A accessing tenant A key failed: %v", err)
	}

	// Tenant B attempting to access Tenant A key -> REJECTED
	if err := ValidateKey(keyA, tenantB); err == nil {
		t.Errorf("expected cross-tenant rejection for tenant B accessing tenant A key, got nil")
	}

	// Legacy unpartitioned key -> allowed for backwards compatibility
	legacyKey := "staging/uploads/2026/09/14/1-legacy.pdf"
	if err := ValidateKey(legacyKey, tenantB); err != nil {
		t.Errorf("legacy unpartitioned key should be permitted: %v", err)
	}
}

func TestDerivedKeyScoped(t *testing.T) {
	ts := time.Date(2026, 9, 14, 12, 0, 0, 0, time.UTC)
	t.Setenv("S3_KEY_PREFIX", "staging")

	key := DerivedKeyScoped("tenant-123", "contract.pdf", ts)
	expectedPrefix := "staging/uploads/tenant-123/2026/09/14/"
	if !strings.HasPrefix(key, expectedPrefix) {
		t.Errorf("expected key to start with %q, got %q", expectedPrefix, key)
	}
}

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

	_, err := PresignedGetURL(context.Background(), "any", 0)
	if err == nil || !strings.Contains(err.Error(), "not initialised") {
		t.Errorf("PresignedGetURL without Init should fail loudly, got: %v", err)
	}
}

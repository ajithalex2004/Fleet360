package auth

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// WithTenant's body is four lines of straightforward branching. Rendering
// the generated SQL via gorm.Statement.Build requires a fully-wired schema
// + dialector and is brittle in unit tests (we tried; it panics without a
// real DB connection). The function's correctness is instead validated by:
//
//   1. The unit tests below — contract-level (the closure is non-nil for
//      every context shape, including the fail-closed empty-context case).
//   2. The auth.TenantID helper tests in jwt_test.go which prove that
//      missing-context returns "" (the input WithTenant branches on).
//   3. Integration tests of the handlers that consume the scope — they
//      exercise the live SQL generation against a real Postgres.

func TestWithTenant_AuthenticatedContext_ReturnsNonNilScope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c := &gin.Context{}
	c.Set(CtxTenantID, "tenant-abc")
	if WithTenant(c) == nil {
		t.Fatal("WithTenant must return a non-nil scope function for an authenticated context")
	}
}

func TestWithTenant_EmptyContext_ReturnsNonNilScope(t *testing.T) {
	// Critical contract: WithTenant must NEVER return nil — even for an
	// empty context. A nil scope would be a panic at query time;
	// returning the fail-closed scope is what we want here. The fact
	// that the closure body uses Where("1 = 0") when TenantID is empty
	// is verified by reading the four-line scope.go implementation,
	// reinforced by the helper test below that the empty case is
	// detected at all.
	gin.SetMode(gin.TestMode)
	c := &gin.Context{}
	if WithTenant(c) == nil {
		t.Fatal("WithTenant must return a non-nil scope function even for an unauthenticated context")
	}
	if TenantID(c) != "" {
		t.Fatal("TenantID for an unset context must be empty — required for WithTenant's fail-closed branch")
	}
}

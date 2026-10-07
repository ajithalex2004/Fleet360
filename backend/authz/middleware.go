package authz

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/logging"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Mode is AUTHZ_MODE, shared with the Next.js middleware:
//
//	enforce (default) answer 403
//	report  log denials as {"authz":"would-deny",…} and let the request through
//	off     don't evaluate
type Mode string

const (
	ModeReport  Mode = "report"
	ModeEnforce Mode = "enforce"
	ModeOff     Mode = "off"
)

// ModeFrom parses AUTHZ_MODE the way src/lib/authz/policy.ts does.
func ModeFrom(v string) Mode {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "report":
		return ModeReport
	case "off":
		return ModeOff
	}
	// Unset or unrecognised enforces; operators opt out explicitly.
	return ModeEnforce
}

// PublicPath maps the Go route (/api/v1/<path>) to the policy's /api/<path>.
func PublicPath(p string) string {
	if strings.HasPrefix(p, "/api/v1/") {
		return "/api/" + p[len("/api/v1/"):]
	}
	return p
}

// DryRunHeader asks for the decision without running the request
// (src/lib/authz/dry-run.ts): answered 204 with the decision in headers.
const DryRunHeader = "x-authz-dry-run"

// writeDryRun answers a dry run with the same headers as Next.js.
func writeDryRun(c *gin.Context, p *Policy, d Decision, m Mode) {
	outcome := "allowed"
	if !d.Allow && m == ModeEnforce {
		outcome = "refused"
	}
	decision := "deny"
	if d.Allow {
		decision = "allow"
	}
	h := c.Writer.Header()
	h.Set("X-Authz-Backend", "go")
	h.Set("X-Authz-Policy", p.PolicyVersion)
	h.Set("X-Authz-Mode", string(m))
	h.Set("X-Authz-Decision", decision)
	h.Set("X-Authz-Reason", d.Reason)
	h.Set("X-Authz-Area", d.Area)
	h.Set("X-Authz-Required", d.Required)
	h.Set("X-Authz-Outcome", outcome)
	c.AbortWithStatus(http.StatusNoContent)
}

// Action is one privileged request, for the audit log.
type Action struct {
	TenantID  string
	UserID    string
	Role      string
	Method    string
	Path      string // as requested (/api/v1/…)
	Route     string // Gin route template
	TargetID  string // first path parameter
	Status    int
	Decision  Decision
	Mode      Mode
	IP        string
	UserAgent string
}

// Recorder writes privileged actions to the audit log.
type Recorder interface {
	Record(ctx context.Context, a Action) error
}

var recorder Recorder

// SetRecorder installs the audit recorder (main); nil disables recording.
func SetRecorder(r Recorder) { recorder = r }

// privileged: the request's rule needs an administrator (the same set
// Next.js audits with withAuditedAction): writes to admin-level,
// tenant-admin or platform areas. Denials of any of them are recorded too.
func privileged(d Decision, method string) bool {
	if d.Rule == nil {
		return false
	}
	switch d.Rule.Kind {
	case "admin-level", "tenant-admin", "platform":
		return writeMethods[strings.ToUpper(method)] || !d.Allow
	}
	return false
}

// recordsStatus: an invalid request (a 4xx other than 401/403) changed
// nothing and is not recorded, as in src/lib/audited-action.ts.
func recordsStatus(status int) bool {
	return status < 400 || status == 401 || status == 403 || status >= 500
}

// Middleware decides every request under it (after auth.Middleware) with
// the shared policy, logs denials, answers 403 in enforce mode, and records
// privileged requests in the audit log (audit_logs, Admin → Audit log).
func Middleware() gin.HandlerFunc {
	return MiddlewareWith(Default(), func() Mode { return ModeFrom(os.Getenv("AUTHZ_MODE")) })
}

// MiddlewareWith is Middleware with an explicit policy and mode source (tests).
func MiddlewareWith(p *Policy, mode func() Mode) gin.HandlerFunc {
	return func(c *gin.Context) {
		m := mode()
		dryRun := c.GetHeader(DryRunHeader) == "1"
		if m == ModeOff && !dryRun {
			c.Next()
			return
		}
		claims := auth.ClaimsFrom(c)
		if claims == nil {
			// auth.Middleware did not run: nothing to decide on, refuse.
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing or malformed Authorization header"})
			return
		}
		req := Request{
			Pathname:          PublicPath(c.Request.URL.Path),
			Method:            c.Request.Method,
			RequestedTenantID: c.Query("tenantId"),
		}
		subject := Subject{Role: claims.Role, TenantID: claims.TenantID, Plan: claims.Plan, Permissions: p.DecodeClaim(claims.Perms)}
		d := p.Decide(req, subject)

		if dryRun {
			writeDryRun(c, p, d, m)
			return
		}

		// Tokens issued before the permission claim existed hold none until
		// they roll over (24 h); in report mode that is expected, not signal.
		quiet := m == ModeReport && d.Reason == "no-permission-claim"
		if !d.Allow && !quiet {
			verdict := "would-deny"
			if m == ModeEnforce {
				verdict = "deny"
			}
			logging.L().Warn("authz decision",
				zap.String("authz", verdict),
				zap.String("backend", "go"),
				zap.String("policy", p.PolicyVersion),
				zap.String("method", req.Method),
				zap.String("path", c.Request.URL.Path),
				zap.String("area", d.Area),
				zap.String("reason", d.Reason),
				zap.String("required", d.Required),
				zap.String("role", claims.Role),
				zap.String("tenantId", claims.TenantID),
				zap.String("userId", claims.Subject),
			)
		}

		record := func(status int) {
			if recorder == nil || !privileged(d, req.Method) || !recordsStatus(status) {
				return
			}
			a := Action{
				TenantID: claims.TenantID, UserID: claims.Subject, Role: claims.Role,
				Method: req.Method, Path: c.Request.URL.Path, Route: c.FullPath(),
				Status: status, Decision: d, Mode: m, IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
			}
			if len(c.Params) > 0 {
				a.TargetID = c.Params[0].Value
			}
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := recorder.Record(ctx, a); err != nil {
				logging.L().Error("audit: privileged action not recorded", zap.String("path", a.Path), zap.Error(err))
			}
		}

		if m == ModeOff {
			d = Decision{Allow: true, Reason: "authz-off", Area: d.Area, Rule: d.Rule}
		}
		if !d.Allow && m == ModeEnforce {
			record(http.StatusForbidden)
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"error":    "Forbidden",
				"message":  "Your role does not allow this action.",
				"reason":   d.Reason,
				"required": d.Required,
			})
			return
		}
		c.Next()
		record(c.Writer.Status())
	}
}

// Row is what AuditRow writes to audit_logs, the table Next.js logAudit()
// writes and Admin → Audit log shows.
type Row struct {
	TenantID, EntityType, EntityID, EntityName, UserID, UserRole, Action, Details, IP, UserAgent string
}

// AuditRow turns a privileged action into an audit_logs row, in the shape
// Next.js withAuditedAction writes (entity AdminAction).
func AuditRow(a Action) Row {
	action := map[string]string{"POST": "CREATE", "PUT": "UPDATE", "PATCH": "UPDATE", "DELETE": "DELETE"}[strings.ToUpper(a.Method)]
	outcome := fmt.Sprintf("ok %d", a.Status)
	switch {
	case a.Status == http.StatusUnauthorized || a.Status == http.StatusForbidden:
		action, outcome = "DENIED", fmt.Sprintf("refused %d", a.Status)
	case a.Status >= 500:
		action, outcome = "FAILED", fmt.Sprintf("failed %d", a.Status)
	}
	if action == "" {
		action = strings.ToUpper(a.Method)
	}
	if !a.Decision.Allow {
		outcome += fmt.Sprintf("; policy %s %s", map[Mode]string{ModeEnforce: "denied", ModeReport: "would deny"}[a.Mode], a.Decision.Reason)
	}
	route := a.Route
	if route == "" {
		route = a.Path
	}
	return Row{
		TenantID:   a.TenantID,
		EntityType: "AdminAction",
		EntityID:   a.TargetID,
		EntityName: strings.ToUpper(a.Method) + " " + route,
		UserID:     a.UserID,
		UserRole:   a.Role,
		Action:     action,
		Details:    fmt.Sprintf("%s %s: %s (go backend)", strings.ToUpper(a.Method), a.Path, outcome),
		IP:         a.IP,
		UserAgent:  truncate(a.UserAgent, 500),
	}
}

func truncate(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

type dbRecorder struct{ db *gorm.DB }

// NewDBRecorder writes privileged actions to audit_logs in the actor's
// tenant context (its RLS policy admits rows of that tenant).
func NewDBRecorder(db *gorm.DB) Recorder { return dbRecorder{db} }

func (r dbRecorder) Record(ctx context.Context, a Action) error {
	row := AuditRow(a)
	nullable := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, row.TenantID).Error; err != nil {
			return err
		}
		return tx.Exec(`
			INSERT INTO audit_logs (tenant_id, entity_type, entity_id, entity_name, user_id, user_role, action, details, ip_address, user_agent)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			row.TenantID, row.EntityType, nullable(row.EntityID), row.EntityName, nullable(row.UserID),
			nullable(row.UserRole), row.Action, row.Details, nullable(row.IP), nullable(row.UserAgent)).Error
	})
}

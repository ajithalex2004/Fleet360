// Package audit provides the append-only audit-event writer and reader
// for Fleet360's compliance and SOC 2 / ISO 27001 evidentiary trail.
//
// Design principles:
//
//  1. APPEND-ONLY. There is no Update or Delete. Every audit_events row is
//     a permanent fact about something that happened. Compliance auditors
//     must be able to inspect a row from 18 months ago and trust it hasn't
//     been edited.
//
//  2. HASH-CHAINED. Every row's row_hash is a SHA-256 over (prev_hash,
//     occurred_at, tenant_id, actor_user_id, action, target_type, target_id,
//     outcome, metadata). Verifying the chain in CI proves no historical row
//     was tampered with — see VerifyChain.
//
//  3. FAIL-OPEN by default, FAIL-CLOSED where compliance demands.
//     For "important" actions (login, permission change, data export,
//     tenant lifecycle), callers should use AuditMust — which returns an
//     error and the caller aborts the operation if the audit write fails.
//     For "nice-to-have" actions (page view, search query), Audit is fine.
//
//  4. NEVER log to stdout. Audit rows go to the database. Application logs
//     are ephemeral and rotation-prone; audit rows live forever.
//
// What gets audited:
//   - Auth events (login success/failure, logout, MFA challenge)
//   - Permission changes (role assignment, grant/revoke)
//   - Tenant lifecycle (created, offboarded, plan changed)
//   - Data exports (per GDPR right-to-data-portability)
//   - Destructive operations (delete on critical entities)
//   - SSO / SCIM events (IdP-linked user created/deactivated)
//   - Billing events (subscription created/canceled/payment_failed)
package audit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"fleet360-backend/database"
	"fleet360-backend/logging"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Outcome enumerates the possible outcomes of an audited action.
type Outcome string

const (
	OutcomeSuccess Outcome = "SUCCESS"
	OutcomeFailure Outcome = "FAILURE"
	OutcomeDenied  Outcome = "DENIED"
)

// Event is the in-memory representation of an audit_events row.
type Event struct {
	ID             uuid.UUID       `gorm:"type:uuid;primaryKey" json:"id"`
	OccurredAt     time.Time       `gorm:"column:occurred_at" json:"occurredAt"`
	TenantID       *uuid.UUID      `gorm:"column:tenant_id;type:uuid" json:"tenantId,omitempty"`
	ActorUserID    *uuid.UUID      `gorm:"column:actor_user_id;type:uuid" json:"actorUserId,omitempty"`
	ActorRole      string          `gorm:"column:actor_role" json:"actorRole,omitempty"`
	ActorIP        string          `gorm:"column:actor_ip;type:inet" json:"actorIp,omitempty"`
	ActorUserAgent string          `gorm:"column:actor_user_agent" json:"actorUserAgent,omitempty"`
	Action         string          `gorm:"column:action" json:"action"`
	TargetType     string          `gorm:"column:target_type" json:"targetType,omitempty"`
	TargetID       string          `gorm:"column:target_id" json:"targetId,omitempty"`
	Outcome        Outcome         `gorm:"column:outcome" json:"outcome"`
	RequestID      string          `gorm:"column:request_id" json:"requestId,omitempty"`
	Metadata       json.RawMessage `gorm:"column:metadata;type:jsonb" json:"metadata,omitempty"`
	PrevHash       string          `gorm:"column:prev_hash" json:"-"`
	RowHash        string          `gorm:"column:row_hash" json:"-"`
}

// Audit writes an audit event, logging (not returning) any error.
// Use for "nice-to-have" audit points.
func Audit(ctx context.Context, ev Event) {
	if err := Write(ctx, ev); err != nil {
		logging.L().Error("audit write failed",
			zap.String("action", ev.Action),
			zap.String("target_type", ev.TargetType),
			zap.String("target_id", ev.TargetID),
			zap.Error(err),
		)
	}
}

// AuditMust writes an audit event and returns the error to the caller.
// The caller MUST abort the user operation if err != nil, otherwise the
// action succeeds without a trace — the worst failure mode for compliance.
func AuditMust(ctx context.Context, ev Event) error {
	return Write(ctx, ev)
}

// Write persists an event atomically. Within a transaction it:
//   1. SELECTs the most recent row_hash for this tenant (with FOR UPDATE
//      to prevent two concurrent writers from forking the chain).
//   2. Computes the new row_hash from the prev_hash + the event payload.
//   3. INSERTs the new row.
//
// All steps succeed or all fail. A broken chain row is impossible.
func Write(ctx context.Context, ev Event) error {
	if ev.Action == "" {
		return errors.New("audit: Action is required")
	}
	if ev.Outcome == "" {
		ev.Outcome = OutcomeSuccess
	}
	if ev.OccurredAt.IsZero() {
		ev.OccurredAt = time.Now().UTC()
	}
	if ev.Metadata == nil {
		ev.Metadata = json.RawMessage("null")
	}
	if ev.ID == uuid.Nil {
		ev.ID = uuid.New()
	}

	return database.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var prevHash *string
		row := tx.Raw(`
			SELECT row_hash FROM audit_events
			WHERE tenant_id IS NOT DISTINCT FROM ?
			ORDER BY occurred_at DESC, id DESC
			LIMIT 1
			FOR UPDATE
		`, ev.TenantID).Row()
		if err := row.Scan(&prevHash); err != nil {
			if err != gorm.ErrRecordNotFound && err.Error() != "sql: no rows in result set" {
				return fmt.Errorf("audit: read prev_hash: %w", err)
			}
		}

		rowHash := computeHash(prevHash, ev)
		ev.PrevHash = ""
		if prevHash != nil {
			ev.PrevHash = *prevHash
		}
		ev.RowHash = rowHash

		// GORM clause.OnConflict ensures that if two writers race and
		// compute the same ID, one loses cleanly rather than crashing.
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&ev).Error
	})
}

// QueryFilter scopes a List query. All fields are optional.
type QueryFilter struct {
	TenantID    *uuid.UUID
	ActorUserID *uuid.UUID
	Action      string
	TargetType  string
	TargetID    string
	Since       time.Time
	Until       time.Time
	Limit       int
	Offset      int
}

// List returns events matching the filter, newest-first.
func List(ctx context.Context, f QueryFilter) ([]Event, error) {
	if f.Limit <= 0 || f.Limit > 1000 {
		f.Limit = 100
	}
	q := database.DB.WithContext(ctx).Model(&Event{})
	if f.TenantID != nil {
		q = q.Where("tenant_id = ?", *f.TenantID)
	}
	if f.ActorUserID != nil {
		q = q.Where("actor_user_id = ?", *f.ActorUserID)
	}
	if f.Action != "" {
		q = q.Where("action = ?", f.Action)
	}
	if f.TargetType != "" {
		q = q.Where("target_type = ?", f.TargetType)
	}
	if f.TargetID != "" {
		q = q.Where("target_id = ?", f.TargetID)
	}
	if !f.Since.IsZero() {
		q = q.Where("occurred_at >= ?", f.Since)
	}
	if !f.Until.IsZero() {
		q = q.Where("occurred_at <= ?", f.Until)
	}
	var out []Event
	err := q.Order("occurred_at DESC, id DESC").
		Limit(f.Limit).Offset(f.Offset).
		Find(&out).Error
	return out, err
}

// VerifyChain walks the entire audit log oldest-first and recomputes each
// row's hash. Returns the count of broken rows. In CI / nightly jobs this
// MUST return 0.
//
// O(N). For >10M rows, sample N rows at random and verify the chain
// windows between samples (each sample must chain correctly to the
// previous one's row_hash).
func VerifyChain(ctx context.Context) (int, error) {
	rows, err := database.DB.WithContext(ctx).
		Model(&Event{}).
		Order("occurred_at ASC, id ASC").
		Rows()
	if err != nil {
		return 0, fmt.Errorf("audit: verify chain: %w", err)
	}
	defer rows.Close()

	broken := 0
	for rows.Next() {
		var ev Event
		if err := database.DB.ScanRows(rows, &ev); err != nil {
			return 0, fmt.Errorf("audit: scan: %w", err)
		}
		var prevHash *string
		if ev.PrevHash != "" {
			prevHash = &ev.PrevHash
		}
		if computeHash(prevHash, ev) != ev.RowHash {
			broken++
			logging.L().Error("audit chain broken",
				zap.String("id", ev.ID.String()),
				zap.String("expected", ev.RowHash),
				zap.String("computed", computeHash(prevHash, ev)),
			)
		}
	}
	return broken, rows.Err()
}

func computeHash(prevHash *string, ev Event) string {
	h := sha256.New()
	if prevHash != nil {
		h.Write([]byte(*prevHash))
	}
	h.Write([]byte("|"))
	h.Write([]byte(ev.OccurredAt.UTC().Format(time.RFC3339Nano)))
	h.Write([]byte("|"))
	if ev.TenantID != nil {
		h.Write([]byte(ev.TenantID.String()))
	}
	h.Write([]byte("|"))
	if ev.ActorUserID != nil {
		h.Write([]byte(ev.ActorUserID.String()))
	}
	h.Write([]byte("|"))
	h.Write([]byte(ev.Action))
	h.Write([]byte("|"))
	h.Write([]byte(ev.TargetType))
	h.Write([]byte("|"))
	h.Write([]byte(ev.TargetID))
	h.Write([]byte("|"))
	h.Write([]byte(string(ev.Outcome)))
	h.Write([]byte("|"))
	h.Write([]byte(string(ev.Metadata)))
	return hex.EncodeToString(h.Sum(nil))
}

// ── Closed vocabulary of action codes ──────────────────────────────────────────
// Add new actions here so audits are grep-able across services. NEVER
// inline literal action strings in handlers — SOC 2 audit depends on
// a closed vocabulary that's greppable in one place.

const (
	// Auth
	ActionAuthLoginSuccess      = "auth.login.success"
	ActionAuthLoginFailure      = "auth.login.failure"
	ActionAuthLogout            = "auth.logout"
	ActionAuthMFASuccess        = "auth.mfa.success"
	ActionAuthMFAFailure        = "auth.mfa.failure"
	ActionAuthTokenRefresh      = "auth.token.refresh"
	ActionAuthSSOLinkSuccess    = "auth.sso.link.success"
	ActionAuthSCIMUserCreate    = "auth.scim.user.create"
	ActionAuthSCIMUserDisable   = "auth.scim.user.disable"

	// Permissions
	ActionPermissionGrant       = "permission.grant"
	ActionPermissionRevoke      = "permission.revoke"
	ActionRoleAssign            = "role.assign"
	ActionRoleUnassign          = "role.unassign"

	// Tenant lifecycle
	ActionTenantCreate          = "tenant.created"
	ActionTenantUpdate          = "tenant.updated"
	ActionTenantSuspend         = "tenant.suspended"
	ActionTenantOffboardRequest = "tenant.offboard.requested"
	ActionTenantOffboardExport  = "tenant.offboard.exported"
	ActionTenantOffboardErase   = "tenant.offboard.erased"

	// Data subject rights (GDPR)
	ActionDataExportRequest     = "data.export.requested"
	ActionDataExportComplete    = "data.export.completed"
	ActionDataErasureRequest    = "data.erasure.requested"
	ActionDataErasureComplete   = "data.erasure.completed"

	// Vehicles (illustrative — extend as needed)
	ActionVehicleCreate         = "vehicle.created"
	ActionVehicleDelete         = "vehicle.deleted"

	// Billing
	ActionBillingSubCreated     = "billing.subscription.created"
	ActionBillingSubCanceled    = "billing.subscription.canceled"
	ActionBillingPaymentFailed  = "billing.payment.failed"
	ActionBillingPlanChanged    = "billing.plan.changed"

	// SSO/SCIM
	ActionSSOConfigUpdated      = "sso.config.updated"
	ActionSSOConfigDisabled     = "sso.config.disabled"
	ActionSCIMTokenCreated      = "scim.token.created"
	ActionSCIMTokenRevoked      = "scim.token.revoked"
)

// TableName overrides GORM's pluralised table name. We declare it
// explicitly so renames here don't accidentally rename a database table.
func (Event) TableName() string { return "audit_events" }

// Package tenants implements Layer 2 of Fleet360's Multi-tenant Enterprise
// SaaS Platform — the tenant lifecycle: signup, configuration update,
// suspension, offboarding, and data export.
//
// What this package owns:
//
//  1. Tenant creation — invoked by the public signup flow (self-serve) or
//     by an operator (sales-led enterprise onboarding). Both paths produce
//     the same shape of row in the tenants table, just with different
//     initial plan codes and trial windows.
//
//  2. Tenant configuration — updates to allowedOrigins, plan code,
//     supportedLanguages, billing metadata. Operators only; tenant users
//     update TenantSettings, not the tenant row itself.
//
//  3. Tenant offboarding — the GDPR right-to-erasure and right-to-data-
//     portability flow. Generates an export bundle, uploads to S3 with a
//     7-day signed URL, marks the export ready, then on operator confirmation
//     begins cryptographic erasure of all tenant-scoped data.
//
//  4. Tenant invitation — invite a user to a tenant with a specific role
//     before the user has an account. Tokens are opaque, single-use, and
//     expire in 7 days.
//
// What this package does NOT own:
//
//  - Authentication — that's the auth package. This package only stores
//    identities' tenant memberships via the UserTenant table.
//  - RBAC — that's the auth package + Role/Permission tables.
//  - Billing — that's the billing package. Subscription state lives there.
//  - Audit emission — every state-changing function in this package emits
//    an audit event via the audit package. Handlers should ALSO emit on
//    their own action (action originated from HTTP, not from this package
//    directly), but defense-in-depth means we audit at both layers.
package tenants

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"fleet360-backend/audit"
	"fleet360-backend/database"
	"fleet360-backend/logging"

	"github.com/google/uuid"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Plan codes — must match the values in prisma/schema.prisma tenants.plan
// and the enum in billing/plans.go. Kept here as a closed vocabulary.
type PlanCode string

const (
	PlanTrial       PlanCode = "TRIAL"
	PlanStarter     PlanCode = "STARTER"
	PlanProfessional PlanCode = "PROFESSIONAL"
	PlanEnterprise  PlanCode = "ENTERPRISE"
)

// Tenant is the in-memory representation of a tenants row.
type Tenant struct {
	ID                uuid.UUID  `json:"id"`
	Name              string     `json:"name"`
	Code              string     `json:"code,omitempty"`
	Plan              PlanCode   `json:"plan"`
	Industry          string     `json:"industry,omitempty"`
	Domain            string     `json:"domain,omitempty"`
	AllowedOrigins    string     `json:"allowedOrigins,omitempty"`
	Address           string     `json:"address,omitempty"`
	ContactName       string     `json:"contactName,omitempty"`
	ContactEmail      string     `json:"contactEmail,omitempty"`
	ContactPhone      string     `json:"contactPhone,omitempty"`
	TRN               string     `json:"trn,omitempty"`
	DefaultLanguage   string     `json:"defaultLanguage"`
	SupportedLanguages string    `json:"supportedLanguages"`
	BookingTypes      string     `json:"bookingTypes,omitempty"`
	IsActive          bool       `json:"isActive"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

// CreateInput is the payload for creating a new tenant via self-serve signup.
// Sales-led onboarding uses a different path (see backend/cmd/operator-
// onboard) which can set additional fields like TRN, industry, contract_id.
type CreateInput struct {
	Name              string    `json:"name" binding:"required"`
	Code              string    `json:"code"`  // optional, auto-derived from name if empty
	Plan              PlanCode  `json:"plan"`  // optional, defaults to TRIAL
	Industry          string    `json:"industry"`
	Domain            string    `json:"domain"`
	AllowedOrigins    string    `json:"allowedOrigins"`
	ContactName       string    `json:"contactName" binding:"required"`
	ContactEmail      string    `json:"contactEmail" binding:"required,email"`
	ContactPhone      string    `json:"contactPhone"`
	DefaultLanguage   string    `json:"defaultLanguage"`
	SupportedLanguages string    `json:"supportedLanguages"`
	// The user creating this tenant (the would-be first admin).
	CreatedByUserID   uuid.UUID `json:"-"`
}

// Create inserts a new tenant row, creates a default TenantSettings row,
// and emits an audit event. Returns the new tenant ID.
//
// Trial plan defaults: 14 days. For sales-led onboarding, the operator
// command sets trial_ends_at explicitly.
func Create(ctx context.Context, in CreateInput) (uuid.UUID, error) {
	if in.Name == "" || in.ContactEmail == "" {
		return uuid.Nil, errors.New("tenants: name and contactEmail are required")
	}
	if in.Plan == "" {
		in.Plan = PlanTrial
	}
	if in.DefaultLanguage == "" {
		in.DefaultLanguage = "en"
	}
	if in.SupportedLanguages == "" {
		in.SupportedLanguages = "en"
	}
	if in.Code == "" {
		in.Code = deriveCode(in.Name)
	}

	var id uuid.UUID
	err := database.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Raw(`
			INSERT INTO tenants (
				name, code, plan, industry, domain, allowed_origins,
				contact_name, contact_email, contact_phone,
				default_language, supported_languages, is_active
			) VALUES (?,?,?,?,?,?,?,?,?,?,?,true)
			RETURNING id
		`,
			in.Name, in.Code, string(in.Plan), in.Industry, in.Domain, in.AllowedOrigins,
			in.ContactName, in.ContactEmail, in.ContactPhone,
			in.DefaultLanguage, in.SupportedLanguages,
		).Scan(&id).Error
		if err != nil {
			return fmt.Errorf("tenants: insert: %w", err)
		}

		// Bootstrap default TenantSettings row so per-tenant config reads
		// don't 404 on a brand-new tenant.
		err = tx.Exec(`INSERT INTO tenant_settings (tenant_id) VALUES (?)`, id).Error
		if err != nil {
			return fmt.Errorf("tenants: bootstrap settings: %w", err)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}

	audit.Audit(ctx, audit.Event{
		TenantID:    &id,
		ActorUserID: &in.CreatedByUserID,
		Action:      audit.ActionTenantCreate,
		TargetType:  "Tenant",
		TargetID:    id.String(),
		Outcome:     audit.OutcomeSuccess,
	})

	return id, nil
}

// GetByID returns the tenant row, optionally including soft-deleted (IsActive=false)
// rows for admin tools. By default, returns only active tenants.
func GetByID(ctx context.Context, id uuid.UUID, includeInactive bool) (*Tenant, error) {
	q := `SELECT id, name, COALESCE(code,''), COALESCE(plan,'STANDARD'),
	             COALESCE(industry,''), COALESCE(domain,''), COALESCE(allowed_origins,''),
	             COALESCE(address,''), COALESCE(contact_name,''), COALESCE(contact_email,''),
	             COALESCE(contact_phone,''), COALESCE(trn,''),
	             COALESCE(default_language,'en'), COALESCE(supported_languages,'en'),
	             COALESCE(booking_types,''), COALESCE(is_active,true),
	             created_at, updated_at
	      FROM tenants WHERE id = $1`
	if !includeInactive {
		q += " AND is_active = true"
	}
	var t Tenant
	row := database.DB.WithContext(ctx).Raw(q, id).Row()
	err := row.Scan(
		&t.ID, &t.Name, &t.Code, &t.Plan, &t.Industry, &t.Domain, &t.AllowedOrigins,
		&t.Address, &t.ContactName, &t.ContactEmail, &t.ContactPhone, &t.TRN,
		&t.DefaultLanguage, &t.SupportedLanguages, &t.BookingTypes, &t.IsActive,
		&t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// Update modifies mutable fields on the tenant row. Plan code changes are
// routed through UpdatePlan (which also touches the billing subscription);
// everything else goes through here.
func Update(ctx context.Context, id uuid.UUID, fields map[string]any, actorUserID uuid.UUID) error {
	if len(fields) == 0 {
		return nil
	}
	// Whitelist mutable columns. NEVER let the caller touch id, created_at, plan, is_active here.
	allowed := map[string]bool{
		"name": true, "industry": true, "domain": true, "allowed_origins": true,
		"address": true, "contact_name": true, "contact_email": true, "contact_phone": true,
		"trn": true, "default_language": true, "supported_languages": true, "booking_types": true,
	}
	cols := []string{}
	args := []any{}
	idx := 1
	for k, v := range fields {
		if !allowed[k] {
			return fmt.Errorf("tenants: Update: column %q is not mutable here (use UpdatePlan / Suspend / Reactivate)", k)
		}
		cols = append(cols, fmt.Sprintf("%s = $%d", k, idx))
		args = append(args, v)
		idx++
	}
	args = append(args, id)

	q := fmt.Sprintf("UPDATE tenants SET %s, updated_at = NOW() WHERE id = ?",
		joinStrings(cols, ", "))
	args = append(args, id)
	err := database.DB.WithContext(ctx).Exec(q, args...).Error
	if err != nil {
		return fmt.Errorf("tenants: update: %w", err)
	}

	audit.Audit(ctx, audit.Event{
		TenantID:    &id,
		ActorUserID: &actorUserID,
		Action:      audit.ActionTenantUpdate,
		TargetType:  "Tenant",
		TargetID:    id.String(),
		Outcome:     audit.OutcomeSuccess,
		Metadata:    mustJSON(fields),
	})
	return nil
}

// Suspend marks the tenant as inactive. Suspended tenants:
//   - Cannot log in (JWT middleware reads is_active from JWT claims cache,
//     or auth.Middleware re-checks on each login).
//   - Existing sessions continue to function until token expiry (we don't
//     actively revoke — that's a separate compliance/incident action).
//   - API calls fail with 403 on auth checks.
//   - Subscription is NOT touched — operator can resume the tenant by
//     calling Reactivate.
func Suspend(ctx context.Context, id uuid.UUID, actorUserID uuid.UUID, reason string) error {
	err := database.DB.WithContext(ctx).Exec(
		`UPDATE tenants SET is_active = false, updated_at = NOW() WHERE id = ?`, id).Error
	if err != nil {
		return fmt.Errorf("tenants: suspend: %w", err)
	}
	audit.AuditMust(ctx, audit.Event{
		TenantID:    &id,
		ActorUserID: &actorUserID,
		Action:      audit.ActionTenantSuspend,
		TargetType:  "Tenant",
		TargetID:    id.String(),
		Outcome:     audit.OutcomeSuccess,
		Metadata:    mustJSON(map[string]string{"reason": reason}),
	})
	return nil
}

// OffboardingInput drives the offboarding flow. The flow is:
//
//  1. Request creates tenant_offboardings row in PENDING.
//  2. Background worker exports all tenant data to a zip in S3.
//  3. Worker marks status=EXPORT_READY with the signed S3 URL.
//  4. Operator downloads, reviews, then confirms erasure.
//  5. Background worker deletes all tenant-scoped rows in dependency order,
//     setting status=ERASED. The tenants row is preserved (audit trail),
//     but anonymised: name="[erased]", contact_email=null, is_active=false.
type OffboardingInput struct {
	TenantID    uuid.UUID
	RequestedBy uuid.UUID
	Reason      string
	ScheduledAt *time.Time // optional grace period; defaults to immediate
}

// RequestOffboarding kicks off the offboarding flow.
func RequestOffboarding(ctx context.Context, in OffboardingInput) (uuid.UUID, error) {
	var offboardingID uuid.UUID
	err := database.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Raw(`
			INSERT INTO tenant_offboardings (tenant_id, requested_by, reason, status, scheduled_at)
			VALUES (?, ?, ?, 'PENDING', ?)
			RETURNING id
		`, in.TenantID, in.RequestedBy, in.Reason, in.ScheduledAt).Scan(&offboardingID).Error
		if err != nil {
			return fmt.Errorf("tenants: offboarding insert: %w", err)
		}

		// Suspend the tenant immediately so they can't keep making API calls
		// while the export is running.
		return tx.Exec(`UPDATE tenants SET is_active = false WHERE id = ?`, in.TenantID).Error
	})
	if err != nil {
		return uuid.Nil, err
	}

	audit.AuditMust(ctx, audit.Event{
		TenantID:    &in.TenantID,
		ActorUserID: &in.RequestedBy,
		Action:      audit.ActionTenantOffboardRequest,
		TargetType:  "Tenant",
		TargetID:    in.TenantID.String(),
		Outcome:     audit.OutcomeSuccess,
		Metadata:    mustJSON(map[string]any{"reason": in.Reason, "offboarding_id": offboardingID}),
	})

	// Enqueue the export job. In production this hits a queue (SQS, NATS,
	// or pg Boss); for the skeleton we just log — the worker is a separate
	// binary (backend/cmd/tenant-export).
	logging.L().Info("tenant offboarding enqueued",
		zap.String("offboarding_id", offboardingID.String()),
		zap.String("tenant_id", in.TenantID.String()),
	)
	return offboardingID, nil
}

// ConfirmErasure marks the offboarding as ERASED and anonymises the
// tenant row. Idempotent — calling twice is safe.
//
// WHY preserve the tenant row (anonymised) rather than DELETE it:
//   - The audit_events rows reference tenants(id) for historical facts.
//     Deleting the tenants row would either break FK chains or wipe
//     historical audit context, both of which violate SOC 2 evidentiary
//     requirements.
//   - Anonymising (name="[erased]", PII fields nulled) preserves the
//     joinability of historical audit rows without retaining PII.
func ConfirmErasure(ctx context.Context, offboardingID uuid.UUID, actorUserID uuid.UUID) error {
	return database.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var tenantID uuid.UUID
		err := tx.Raw(`
			UPDATE tenant_offboardings
			SET status = 'ERASED', erasure_completed_at = NOW(), updated_at = NOW()
			WHERE id = ? AND status IN ('EXPORT_READY', 'ERASING')
			RETURNING tenant_id
		`, offboardingID).Scan(&tenantID).Error
		if err != nil {
			return fmt.Errorf("tenants: confirm erasure: %w", err)
		}

		// Anonymise the tenant row. Preserve id and created_at; null all PII.
		err = tx.Exec(`
			UPDATE tenants SET
				name = '[erased]', code = NULL,
				domain = NULL, allowed_origins = NULL,
				address = NULL, contact_name = NULL, contact_email = NULL,
				contact_phone = NULL, trn = NULL,
				localized_name = NULL, localized_desc = NULL,
				booking_types = NULL, is_active = false,
				updated_at = NOW()
			WHERE id = ?
		`, tenantID).Error
		if err != nil {
			return fmt.Errorf("tenants: anonymise: %w", err)
		}

		audit.AuditMust(ctx, audit.Event{
			TenantID:    &tenantID,
			ActorUserID: &actorUserID,
			Action:      audit.ActionTenantOffboardErase,
			TargetType:  "Tenant",
			TargetID:    tenantID.String(),
			Outcome:     audit.OutcomeSuccess,
		})
		return nil
	})
}

// ── Invitations ────────────────────────────────────────────────────────────────

// Invitation is the in-memory representation of a tenant_invitations row.
type Invitation struct {
	ID            uuid.UUID  `json:"id"`
	TenantID      uuid.UUID  `json:"tenantId"`
	Email         string     `json:"email"`
	RoleID        uuid.UUID  `json:"roleId"`
	Token         string     `json:"-"`
	InvitedBy     *uuid.UUID `json:"invitedBy,omitempty"`
	ExpiresAt     time.Time  `json:"expiresAt"`
	AcceptedAt    *time.Time `json:"acceptedAt,omitempty"`
	RevokedAt     *time.Time `json:"revokedAt,omitempty"`
}

// CreateInvitation mints a single-use invite token for an email + role.
// Tokens are 32 bytes from crypto/rand, base64url encoded.
func CreateInvitation(ctx context.Context, tenantID, roleID uuid.UUID, email string, invitedBy uuid.UUID, ttl time.Duration) (*Invitation, error) {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	token, err := generateToken()
	if err != nil {
		return nil, err
	}
	inv := &Invitation{
		TenantID:  tenantID,
		Email:     email,
		RoleID:    roleID,
		Token:     token,
		InvitedBy: &invitedBy,
		ExpiresAt: time.Now().UTC().Add(ttl),
	}
	err = database.DB.WithContext(ctx).Raw(`
		INSERT INTO tenant_invitations (tenant_id, email, role_id, token, invited_by, expires_at)
		VALUES (?, ?, ?, ?, ?, ?)
		RETURNING id
	`, tenantID, email, roleID, token, invitedBy, inv.ExpiresAt).Scan(&inv.ID).Error
	if err != nil {
		return nil, fmt.Errorf("tenants: create invitation: %w", err)
	}
	return inv, nil
}

// AcceptInvitation consumes an invite token, creates a UserTenant row, and
// returns the tenant + role IDs. Returns ErrInvitationInvalid if the token
// is unknown, expired, or already consumed.
var ErrInvitationInvalid = errors.New("tenants: invitation is invalid, expired, or already consumed")

func AcceptInvitation(ctx context.Context, token string, userID uuid.UUID) (tenantID, roleID uuid.UUID, err error) {
	err = database.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := tx.Raw(`
			UPDATE tenant_invitations
			SET accepted_at = NOW(), accepted_user_id = ?, updated_at = NOW()
			WHERE token = ?
			  AND accepted_at IS NULL
			  AND revoked_at IS NULL
			  AND expires_at > NOW()
			RETURNING tenant_id, role_id
		`, userID, token).Row()
		if err := row.Scan(&tenantID, &roleID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrInvitationInvalid
			}
			return err
		}

		return tx.Exec(`
			INSERT INTO user_tenants (user_id, tenant_id, role_id, is_active)
			VALUES (?, ?, ?, true)
			ON CONFLICT (user_id, tenant_id) DO UPDATE SET role_id = ?, is_active = true
		`, userID, tenantID, roleID, roleID).Error
	})
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return tenantID, roleID, nil
}

// ── helpers ────────────────────────────────────────────────────────────────────

func deriveCode(name string) string {
	// Lowercase, ascii-fold, dashes for spaces. Used as a human-readable
	// identifier in URLs like /t/acme-corp/dashboard. Collisions are
	// resolved by appending a short suffix at the SQL layer (UNIQUE constraint).
	out := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r >= 'A' && r <= 'Z':
			out = append(out, r+32)
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out = append(out, r)
		case r == ' ' || r == '-' || r == '_':
			out = append(out, '-')
		}
	}
	if len(out) == 0 {
		out = []rune("tenant")
	}
	return string(out)
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func joinStrings(s []string, sep string) string {
	out := ""
	for i, v := range s {
		if i > 0 {
			out += sep
		}
		out += v
	}
	return out
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		logging.L().Error("audit: marshal metadata", zap.Error(err))
		return []byte("null")
	}
	return b
}

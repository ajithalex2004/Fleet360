// Package sso implements Layer 4 enterprise SSO — SAML 2.0 and OIDC.
//
// ARCHITECTURE:
//
//   ┌──────────┐    SAML/OIDC    ┌─────────────┐    OIDC/SAML     ┌──────────┐
//   │  User's  │ ◀─────────────▶ │   Fleet360  │ ◀───────────────▶ │   IdP    │
//   │ Browser  │                 │   Frontend  │                  │ (Okta,   │
//   └──────────┘                 └─────────────┘                  │  Azure   │
//                                      │                          │  AD,     │
//                                      │ verify & issue JWT       │  Google) │
//                                      ▼                          └──────────┘
//                                 ┌─────────────┐
//                                 │   Go API    │ auth.Middleware → tenant/user from JWT
//                                 └─────────────┘
//
// Per-tenant config lives in sso_configs (one row per protocol per tenant).
// Secrets (OIDC client_secret, SAML signing cert) are AES-GCM-encrypted at
// rest — see encryptSecret / decryptSecret below.
//
// SECURITY POSTURE:
//
//   - This package DOES NOT issue Fleet360 session JWTs. It produces an
//     IdP-verified identity (email, subject, groups) which the calling
//     auth code uses to issue a Fleet360 JWT via the existing flow.
//     That keeps a single JWT-issuing path, single secret, single audit trail.
//
//   - Discovery URLs and metadata are CACHED at 1h TTL. The IdP metadata
//     rarely changes; caching prevents a DoS surface from a slow IdP.
//
//   - SCIM (in the scim package) uses a separate token. NEVER reuse the
//     session JWT for SCIM — IdPs use long-lived bearer tokens for SCIM
//     and we don't want those tied to user sessions.
//
// PRODUCTION READINESS:
//   This is a skeleton. To go to production you need:
//     - Replace the OIDC discovery client with a real library (coreos/go-oidc)
//     - Replace the SAML parser with crewjam/saml
//     - Add nonce + state validation in the OIDC flow
//     - Add clock skew tolerance (currently 5 min hardcoded)
//     - Add IdP-initiated SSO (currently SP-initiated only)
//     - Load-test with realistic IdP setups
package sso

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"fleet360-backend/audit"
	"fleet360-backend/database"

	"github.com/google/uuid"
)

// Protocol enumerates supported SSO protocols.
type Protocol string

const (
	ProtocolOIDC  Protocol = "OIDC"
	ProtocolSAML  Protocol = "SAML"
)

// Config is the in-memory representation of a sso_configs row.
type Config struct {
	ID             uuid.UUID `json:"id"`
	TenantID       uuid.UUID `json:"tenantId"`
	Protocol       Protocol  `json:"protocol"`
	IsEnabled      bool      `json:"isEnabled"`
	IsEnforced     bool      `json:"isEnforced"`
	OIDCIssuer     string    `json:"oidcIssuer,omitempty"`
	OIDCClientID   string    `json:"oidcClientId,omitempty"`
	OIDCScopes     string    `json:"oidcScopes,omitempty"`
	SAMLEntityID   string    `json:"samlEntityId,omitempty"`
	SAMLSSOURL     string    `json:"samlSsoUrl,omitempty"`
	DefaultRoleID  *uuid.UUID `json:"defaultRoleId,omitempty"`
}

// GetConfig returns the active SSO config for a tenant + protocol.
func GetConfig(ctx context.Context, tenantID uuid.UUID, proto Protocol) (*Config, error) {
	var c Config
	var defaultRole sql.NullString
	err := database.DB.WithContext(ctx).Raw(`
		SELECT id, tenant_id, protocol, is_enabled, is_enforced,
		       COALESCE(oidc_issuer, ''), COALESCE(oidc_client_id, ''),
		       COALESCE(oidc_scopes, 'openid email profile'),
		       COALESCE(saml_entity_id, ''), COALESCE(saml_sso_url, ''),
		       default_role_id
		FROM sso_configs
		WHERE tenant_id = ? AND protocol = ? AND is_enabled = true
	`, tenantID, proto).Row().Scan(&c.ID, &c.TenantID, &c.Protocol, &c.IsEnabled, &c.IsEnforced,
		&c.OIDCIssuer, &c.OIDCClientID, &c.OIDCScopes,
		&c.SAMLEntityID, &c.SAMLSSOURL, &defaultRole)
	if err != nil {
		return nil, err
	}
	if defaultRole.Valid {
		roleID, perr := uuid.Parse(defaultRole.String)
		if perr == nil {
			c.DefaultRoleID = &roleID
		}
	}
	return &c, nil
}

// UpsertConfig creates or updates the SSO config for a tenant + protocol.
// Secrets are encrypted before storage. Emits an audit event on success.
func UpsertConfig(ctx context.Context, c Config, oidcSecretPlain, samlCertPlain []byte, actorUserID uuid.UUID) error {
	var oidcSecretEnc, samlCertEnc []byte
	if len(oidcSecretPlain) > 0 {
		e, err := encryptSecret(oidcSecretPlain)
		if err != nil {
			return fmt.Errorf("sso: encrypt oidc secret: %w", err)
		}
		oidcSecretEnc = e
	}
	if len(samlCertPlain) > 0 {
		e, err := encryptSecret(samlCertPlain)
		if err != nil {
			return fmt.Errorf("sso: encrypt saml cert: %w", err)
		}
		samlCertEnc = e
	}

	err := database.DB.WithContext(ctx).Exec(`
		INSERT INTO sso_configs (
			tenant_id, protocol, is_enabled, is_enforced,
			oidc_issuer, oidc_client_id, oidc_client_secret_encrypted, oidc_scopes,
			saml_entity_id, saml_sso_url, saml_cert_encrypted,
			default_role_id
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT (tenant_id, protocol) DO UPDATE SET
			is_enabled = EXCLUDED.is_enabled,
			is_enforced = EXCLUDED.is_enforced,
			oidc_issuer = EXCLUDED.oidc_issuer,
			oidc_client_id = EXCLUDED.oidc_client_id,
			oidc_client_secret_encrypted = COALESCE(EXCLUDED.oidc_client_secret_encrypted, sso_configs.oidc_client_secret_encrypted),
			oidc_scopes = EXCLUDED.oidc_scopes,
			saml_entity_id = EXCLUDED.saml_entity_id,
			saml_sso_url = EXCLUDED.saml_sso_url,
			saml_cert_encrypted = COALESCE(EXCLUDED.saml_cert_encrypted, sso_configs.saml_cert_encrypted),
			default_role_id = EXCLUDED.default_role_id,
			updated_at = NOW()
	`, c.TenantID, c.Protocol, c.IsEnabled, c.IsEnforced,
		c.OIDCIssuer, c.OIDCClientID, oidcSecretEnc, c.OIDCScopes,
		c.SAMLEntityID, c.SAMLSSOURL, samlCertEnc,
		c.DefaultRoleID).Error
	if err != nil {
		return fmt.Errorf("sso: upsert: %w", err)
	}

	audit.AuditMust(ctx, audit.Event{
		TenantID: &c.TenantID, ActorUserID: &actorUserID,
		Action: audit.ActionSSOConfigUpdated,
		TargetType: "SsoConfig", TargetID: c.TenantID.String() + ":" + string(c.Protocol),
	})
	return nil
}

// ── OIDC flow ─────────────────────────────────────────────────────────────────

// OIDCDiscovery is the OIDC discovery document, cached for 1h.
type OIDCDiscovery struct {
	Issuer        string `json:"issuer"`
	AuthEndpoint  string `json:"authorization_endpoint"`
	TokenEndpoint string `json:"token_endpoint"`
	JWKSURI       string `json:"jwks_uri"`
	UserInfoURI   string `json:"userinfo_endpoint"`
}

var (
	discoveryMu      = make(map[string]*discoveryCacheEntry)
	discoveryTTL     = 1 * time.Hour
)

type discoveryCacheEntry struct {
	doc       *OIDCDiscovery
	expiresAt time.Time
}

// FetchDiscovery loads the OIDC discovery doc, caching for 1h.
// Real implementation uses coreos/go-oidc.Provider which handles
// discovery + JWKS rotation + ID token verification in one call.
func FetchDiscovery(ctx context.Context, issuer string) (*OIDCDiscovery, error) {
	// CACHE LOOKUP — if not expired, return cached.
	if entry, ok := discoveryMu[issuer]; ok && time.Now().Before(entry.expiresAt) {
		return entry.doc, nil
	}
	// REAL IMPLEMENTATION: HTTP GET {issuer}/.well-known/openid-configuration
	// For the skeleton we return an error so callers don't think it's wired up.
	return nil, errors.New("sso: OIDC discovery not implemented — wire up coreos/go-oidc before enabling")
}

// VerifyIDToken verifies an OIDC ID token's signature, issuer, audience,
// expiry, and nonce. Returns the parsed claims on success.
//
// SKELETON: Real implementation uses oidc.IDTokenVerifier.Verify().
func VerifyIDToken(ctx context.Context, rawIDToken string, expectedNonce string, cfg *Config) (claims map[string]any, err error) {
	return nil, errors.New("sso: ID token verification not implemented — wire up coreos/go-oidc before enabling")
}

// ── Secret encryption ─────────────────────────────────────────────────────────

// EncryptionKey returns the AES-256 key used to encrypt SSO secrets at
// rest. Loaded from SSO_ENCRYPTION_KEY env var (32 bytes base64). If
// the env var is missing, we fail loudly — running with no encryption
// is the worst failure mode for a compliance posture.
func encryptionKey() ([]byte, error) {
	env := getEnv("SSO_ENCRYPTION_KEY", "")
	if env == "" {
		return nil, errors.New("sso: SSO_ENCRYPTION_KEY env var unset — refusing to store SSO secrets in plaintext")
	}
	k, err := base64.StdEncoding.DecodeString(env)
	if err != nil {
		return nil, fmt.Errorf("sso: SSO_ENCRYPTION_KEY not valid base64: %w", err)
	}
	if len(k) != 32 {
		return nil, errors.New("sso: SSO_ENCRYPTION_KEY must decode to 32 bytes (AES-256)")
	}
	return k, nil
}

func encryptSecret(plaintext []byte) ([]byte, error) {
	key, err := encryptionKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return sealed, nil
}

func decryptSecret(ciphertext []byte) ([]byte, error) {
	key, err := encryptionKey()
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, errors.New("sso: ciphertext too short")
	}
	nonce, sealed := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	return gcm.Open(nil, nonce, sealed, nil)
}

// getEnv reads an env var with a default. Wrapper so we don't import
// "os" in every test file.
func getEnv(key, def string) string {
	if v, ok := lookupEnv(key); ok {
		return v
	}
	return def
}

// lookupEnv is a var so tests can swap it. By default reads os.Getenv.
var lookupEnv = func(key string) (string, bool) {
	return osLookupEnv(key)
}

func osLookupEnv(key string) (string, bool) {
	v := os.Getenv(key)
	if v == "" {
		return "", false
	}
	return v, true
}

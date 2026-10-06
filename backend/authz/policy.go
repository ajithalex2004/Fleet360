// Package authz makes the Go backend's authorization decision: the same
// policy, from the same data, as the Next.js middleware.
//
// policy.json is generated from the Next.js policy (src/lib/authz/go-policy.ts:
// the route matrix, admin route levels, permission catalogue and version,
// module aliases, trial rules) and embedded here. Decide is a port of
// decide() in src/lib/authz/policy.ts; testdata/vectors.json holds requests
// with the decision Next.js makes, and policy_test.go requires Decide to
// agree on every one. Regenerate both files after a policy change:
//
//	UPDATE_AUTHZ_GO_POLICY=1 npx vitest run tests/unit/authz-go-policy.test.ts
//
// The Go backend serves /api/v1/<path>; the policy is written for
// /api/<path>, the same path Next.js proxies from.
package authz

import (
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

//go:embed policy.json
var policyJSON []byte

// Rule decides one area (a path prefix) for reads or for writes.
type Rule struct {
	Kind   string `json:"kind"`             // module | admin-level | tenant-admin | platform | self | partner | external
	Module string `json:"module,omitempty"` // for kind module
	Action string `json:"action,omitempty"` // for kind module: fixed action, else from the method and path
}

type area struct {
	Prefix string `json:"prefix"`
	Read   Rule   `json:"read"`
	Write  Rule   `json:"write"`
}

type adminRoute struct {
	Template string            `json:"template"`
	Methods  map[string]string `json:"methods"`
	re       *regexp.Regexp
}

// Policy is the decoded policy.json.
type Policy struct {
	PolicyVersion    string              `json:"policyVersion"`
	CatalogueVersion string              `json:"catalogueVersion"`
	Catalogue        []string            `json:"catalogue"`
	ModuleAliases    map[string][]string `json:"moduleAliases"`
	TrialFreeModules []string            `json:"trialFreeModules"`
	SuperAdminRole   string              `json:"superAdminRole"`
	TenantAdminRole  string              `json:"tenantAdminRole"`
	Areas            []area              `json:"areas"`
	AdminRoutes      []adminRoute        `json:"adminRoutes"`

	resources map[string]map[string]bool // module → catalogue resources (not '*')
}

// Parse decodes a policy document.
func Parse(data []byte) (*Policy, error) {
	var p Policy
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("authz: policy: %w", err)
	}
	if p.PolicyVersion == "" || p.CatalogueVersion == "" || len(p.Catalogue) == 0 || len(p.Areas) == 0 {
		return nil, fmt.Errorf("authz: policy is incomplete")
	}
	// Longest prefix wins.
	sort.SliceStable(p.Areas, func(i, j int) bool { return len(p.Areas[i].Prefix) > len(p.Areas[j].Prefix) })
	for i := range p.AdminRoutes {
		p.AdminRoutes[i].re = templateToRegexp(p.AdminRoutes[i].Template)
	}
	p.resources = map[string]map[string]bool{}
	for _, key := range p.Catalogue {
		parts := strings.SplitN(key, ":", 3)
		if len(parts) != 3 || parts[2] == "*" {
			continue
		}
		if p.resources[parts[0]] == nil {
			p.resources[parts[0]] = map[string]bool{}
		}
		p.resources[parts[0]][parts[2]] = true
	}
	return &p, nil
}

var defaultPolicy = func() *Policy {
	p, err := Parse(policyJSON)
	if err != nil {
		panic(err)
	}
	return p
}()

// Default is the embedded policy.
func Default() *Policy { return defaultPolicy }

func templateToRegexp(template string) *regexp.Regexp {
	segs := strings.Split(template, "/")
	for i, s := range segs {
		if s == "[id]" {
			segs[i] = "[^/]+"
		} else {
			segs[i] = regexp.QuoteMeta(s)
		}
	}
	return regexp.MustCompile("^" + strings.Join(segs, "/") + "/?$")
}

// Subject is who is asking: from the verified token.
type Subject struct {
	Role     string
	TenantID string
	Plan     string
	// Permissions from the token's claim; nil when it carries none.
	Permissions []string
}

// Request is what is asked, as an /api/<path> (not /api/v1).
type Request struct {
	Pathname          string
	Method            string
	RequestedTenantID string
}

// Decision mirrors Decision in src/lib/authz/policy.ts.
type Decision struct {
	Allow    bool
	Reason   string
	Area     string // "" when the route is unmapped
	Rule     *Rule
	Required string // module:action:resource, for module rules
}

var writeMethods = map[string]bool{"POST": true, "PUT": true, "PATCH": true, "DELETE": true}

// AreaOf returns the matrix area of an /api path, or "".
func (p *Policy) AreaOf(pathname string) string {
	if !strings.HasPrefix(pathname, "/api/") {
		return ""
	}
	rest := strings.TrimRight(pathname[len("/api/"):], "/")
	for _, a := range p.Areas {
		if rest == a.Prefix || strings.HasPrefix(rest, a.Prefix+"/") {
			return a.Prefix
		}
	}
	return ""
}

func (p *Policy) ruleFor(prefix, method string) *Rule {
	for i := range p.Areas {
		if p.Areas[i].Prefix == prefix {
			if writeMethods[strings.ToUpper(method)] {
				return &p.Areas[i].Write
			}
			return &p.Areas[i].Read
		}
	}
	return nil
}

var (
	exportSeg  = regexp.MustCompile(`(?i)export`)
	csvSeg     = regexp.MustCompile(`(?i)\.csv$`)
	approveSeg = regexp.MustCompile(`(?i)^(approve|approval|approvals|reject|decision)$`)
)

func actionFor(method string, segments []string) string {
	upper := strings.ToUpper(method)
	for _, s := range segments {
		if exportSeg.MatchString(s) || csvSeg.MatchString(s) {
			return "export"
		}
	}
	if writeMethods[upper] {
		for _, s := range segments {
			if approveSeg.MatchString(s) {
				return "approve"
			}
		}
	}
	switch upper {
	case "POST":
		return "create"
	case "PUT", "PATCH":
		return "edit"
	case "DELETE":
		return "delete"
	}
	return "view"
}

func (p *Policy) resourceFor(module string, segments []string) string {
	known := p.resources[module]
	if known == nil {
		return "*"
	}
	for _, s := range segments {
		if known[s] {
			return s
		}
		if u := strings.ReplaceAll(s, "-", "_"); known[u] {
			return u
		}
	}
	return "*"
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// HasPermission mirrors hasPermission in src/lib/permissions.ts (alias-aware).
func (p *Policy) HasPermission(perms []string, module, action, resource string) bool {
	if len(perms) == 0 {
		return false
	}
	if contains(perms, "*:*:*") {
		return true
	}
	keys := append([]string{module}, p.ModuleAliases[module]...)
	for _, m := range keys {
		if contains(perms, m+":"+action+":"+resource) || contains(perms, m+":"+action+":*") || contains(perms, m+":*:*") {
			return true
		}
	}
	return false
}

func (p *Policy) holdsAnyResource(perms []string, module, action string) bool {
	if p.HasPermission(perms, module, action, "*") {
		return true
	}
	for _, x := range perms {
		if strings.HasPrefix(x, module+":"+action+":") || x == module+":*:*" {
			return true
		}
	}
	return false
}

// RequiredAdminLevel mirrors requiredAdminLevel in src/lib/admin-access.ts:
// "" for OPTIONS (no level), else platform | admin | member.
func (p *Policy) RequiredAdminLevel(pathname, method string) string {
	upper := strings.ToUpper(method)
	if upper == "OPTIONS" {
		return ""
	}
	if upper == "HEAD" {
		upper = "GET"
	}
	const prefix = "/api/admin/"
	rel := ""
	if len(pathname) > len(prefix) {
		rel = pathname[len(prefix):]
	}
	for _, r := range p.AdminRoutes {
		if r.re.MatchString(rel) {
			if level, ok := r.Methods[upper]; ok {
				return level
			}
			return "platform"
		}
	}
	return "platform"
}

// RoleSatisfies mirrors roleSatisfies in src/lib/admin-access.ts.
func (p *Policy) RoleSatisfies(role, level string) bool {
	if role == "" {
		return false
	}
	if role == p.SuperAdminRole {
		return true
	}
	switch level {
	case "platform":
		return false
	case "admin":
		return role == p.TenantAdminRole
	}
	return true
}

// Decide mirrors decide() in src/lib/authz/policy.ts.
func (p *Policy) Decide(req Request, s Subject) Decision {
	areaKey := p.AreaOf(req.Pathname)
	if areaKey == "" {
		return Decision{Reason: "unmapped-route"}
	}
	rule := p.ruleFor(areaKey, req.Method)
	d := func(allow bool, reason string) Decision {
		return Decision{Allow: allow, Reason: reason, Area: areaKey, Rule: rule}
	}
	if rule.Kind == "external" || rule.Kind == "partner" {
		return d(true, "delegated")
	}
	role := strings.TrimSpace(s.Role)
	if role == "" {
		return d(false, "missing-role")
	}
	if req.RequestedTenantID != "" && req.RequestedTenantID != s.TenantID && role != p.SuperAdminRole {
		return d(false, "cross-tenant")
	}
	switch rule.Kind {
	case "self":
		return d(true, "granted")
	case "platform":
		if role == p.SuperAdminRole {
			return d(true, "granted")
		}
		return d(false, "platform-only")
	case "tenant-admin":
		if p.RoleSatisfies(role, "admin") {
			return d(true, "granted")
		}
		return d(false, "tenant-admin-only")
	case "admin-level":
		level := p.RequiredAdminLevel(req.Pathname, req.Method)
		if level == "" || p.RoleSatisfies(role, level) {
			return d(true, "granted")
		}
		return d(false, "admin-level:"+level)
	case "module":
		all := strings.Split(req.Pathname[len("/api/"):], "/")
		skip := len(strings.Split(areaKey, "/"))
		var segments []string
		if skip < len(all) {
			segments = all[skip:]
		}
		action := rule.Action
		if action == "" {
			action = actionFor(req.Method, segments)
		}
		resource := p.resourceFor(rule.Module, segments)
		out := func(allow bool, reason string) Decision {
			dec := d(allow, reason)
			dec.Required = rule.Module + ":" + action + ":" + resource
			return dec
		}
		if role == p.SuperAdminRole {
			return out(true, "granted")
		}
		if s.Permissions == nil {
			return out(false, "no-permission-claim")
		}
		if s.Plan == "TRIAL" && action != "view" && !contains(p.TrialFreeModules, rule.Module) {
			return out(false, "trial-read-only")
		}
		var granted bool
		if resource == "*" {
			granted = p.holdsAnyResource(s.Permissions, rule.Module, action)
		} else {
			granted = p.HasPermission(s.Permissions, rule.Module, action, resource)
		}
		if granted {
			return out(true, "granted")
		}
		return out(false, "missing-permission")
	}
	return d(false, "unknown-rule")
}

// PermissionClaim mirrors src/lib/authz/permission-claim.ts.
type PermissionClaim struct {
	V string   `json:"v"`
	B string   `json:"b"`
	X []string `json:"x,omitempty"`
	W int      `json:"w,omitempty"`
}

// DecodeClaim returns the permissions in a token's claim, or nil when it is
// absent, malformed or signed against another catalogue version.
func (p *Policy) DecodeClaim(raw json.RawMessage) []string {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var c PermissionClaim
	if err := json.Unmarshal(raw, &c); err != nil || c.V != p.CatalogueVersion {
		return nil
	}
	bits, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(c.B, "="))
	if err != nil {
		return nil
	}
	out := []string{}
	for i, key := range p.Catalogue {
		if i>>3 < len(bits) && bits[i>>3]&(1<<(uint(i)&7)) != 0 {
			out = append(out, key)
		}
	}
	out = append(out, c.X...)
	if c.W == 1 {
		out = append(out, "*:*:*")
	}
	return out
}

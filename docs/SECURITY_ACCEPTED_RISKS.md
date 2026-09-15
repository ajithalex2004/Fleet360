# Security Architecture: Explicitly Accepted Risks

This registry documents active architectural security tradeoffs and explicitly accepted risks for the Fleet360 platform, including compensatory controls, risk boundary assessments, and migration milestones.

---

## 1. Object Storage: Shared Cloudflare R2 Bucket with Logical Prefix Isolation

### Risk Summary
* **Resource**: Cloudflare R2 Object Storage Bucket `fleet360-uploads`
* **Environments Affected**: Staging and Production
* **Isolation Model**: **Logical prefix isolation** (`staging/` vs `production/`), **not IAM credential isolation**.
* **Risk Classification**: **Explicitly Accepted Risk** (Phase 0 / Logistics Go Migration L0–L4c cutover).

### Architectural Description
The staging and production environments both utilize the Cloudflare R2 bucket `fleet360-uploads`. 
Cloudflare R2 API tokens are issued at the bucket scope with Object Read & Write permissions. As Cloudflare R2 API tokens currently do not provide granular, sub-bucket path/prefix IAM policy restrictions within a single bucket, both environments authenticate using bucket-scoped credentials that have physical read/write capabilities across the bucket.

Environment separation is maintained through directory prefixes:
- **Staging namespace**: `staging/<tenant-id>/<file-id>`
- **Production namespace**: `production/<tenant-id>/<file-id>`

### Compensatory Controls & Defense-in-Depth
1. **Application-Layer Key Prefix Guardrails**:
   - `src/lib/storage.ts` enforces that every storage operation strictly prepends the environment-configured prefix (`process.env.S3_KEY_PREFIX`).
   - The file handlers (`src/app/api/files/sign-url/route.ts` and `src/app/api/files/route.ts`) validate incoming keys against the current environment prefix. Any attempt by a staging caller to sign or delete a key prefixed with `production/` (or vice-versa) is rejected immediately with **HTTP 400 Bad Request**.
2. **Tenant ID Verification in Storage Paths**:
   - Object keys incorporate the authenticated tenant's UUID: `<prefix>/<tenantId>/<fileUUID>`.
   - Access and presigned URL generation mandate tenant context matching the session context (`requireAuthorizedTenant()`).
   - Cross-tenant requests are rejected with **HTTP 403 Forbidden**.
3. **Automated CI/CD Lifecycle Acceptance Gate**:
   - Every staging deployment must execute `scripts/verify-staging-proxy-e2e.js` (`test:staging-acceptance`).
   - The suite performs end-to-end synthetic upload, presigned download, byte-for-byte matching, deletion, and non-retrievability verification, along with cross-tenant and cross-environment traversal rejection tests. A write failure or boundary violation halts promotion.

### Remediation Roadmap (Post-Cutover)
To transition from logical prefix isolation to strict IAM credential isolation:
- Provision a completely separate Cloudflare R2 bucket: `fleet360-uploads-prod` vs `fleet360-uploads-staging`.
- Issue distinct API tokens scoped exclusively to their corresponding bucket, eliminating shared access at the Cloudflare API credential layer.

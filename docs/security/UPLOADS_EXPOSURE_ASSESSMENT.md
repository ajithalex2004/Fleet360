# Stored-file exposure: assessment and containment

**Status:** contained in code (this change). Exposure assessment steps 1–4 below need someone with production access.

## Finding

The web app stored uploaded files under `public/uploads/…` and returned links of the form `/uploads/{prefix}/{uuid}-{name}`. Next.js serves `public/` as static files **without running any route's authorization**:

- Middleware only redirected *browser page navigations* to the login page. A direct request (`curl`, an `<img>` or `fetch`, a link opened by a tool) got the file **without signing in**.
- Any signed-in user, **of any tenant**, could fetch any other tenant's file.
- The only barrier was the random UUID in the file name. Links are not secrets: they are copied into emails, chats, browser history and logs.

Files written by the web app:

| Prefix | Written by | Content | Sensitivity |
|---|---|---|---|
| `leasing/{entity}/{id}/` | `POST /api/leasing/documents/upload` | Lessee and contract documents (IDs, licences, trade licences, contracts) | **Personal data** |
| `leasing-portal/{entity}/{id}/` | `POST /api/leasing-portal/documents` | Documents lessees upload themselves | **Personal data** |
| `rental/handover/{bookingId}/` | `POST /api/rental/counter/handover` | Customer signature images | **Personal data** |
| `branding/{tenantId}/` | `POST /api/admin/tenants/{id}/branding/logo` | Tenant logos | Public by design |

The Go backend stores files in S3-compatible object storage (`backend/objectstore`). It is not affected by this finding and is covered by the wider file, export and cache audit.

## When a file was actually reachable

In production (`next start`), Next.js lists the files in `public/` **once, when the server starts**, and serves only those files. So:

- **No persistent volume on the upload directory:** files uploaded after a start were *not* served (links returned 404), and the container's disk was wiped on each redeploy. Exposure was very unlikely, but uploads were being lost.
- **Persistent volume mounted at `public/uploads` (or `public/`):** every file present at the last server start was served to anyone who had, or could guess, the link, until this fix is deployed.

The first question for the assessment is therefore **whether the production (and staging) service has a volume mounted there**.

## Containment (this change)

- Middleware sends every `/uploads/*` and `/api/files/*` request to `GET /api/files/{key}`, with identity headers only from a verified session. Client-sent identity headers are dropped.
- `/api/files` authorizes each request against the file's **owning record** (`src/lib/storage/file-access.ts`), then streams it:
  - **Lease documents:** the `lease_documents` row with that link, in the caller's tenant, read under the caller's RLS context. Portal lessees only get documents on their own lessee record or their own contracts.
  - **Rental handover signatures:** the booking must belong to the caller's tenant; staff only.
  - **Branding:** public, and served only if the file is an image.
  - **Anything else:** refused.
- Denials return 404, the same as a missing file, so file names cannot be probed across tenants. Anonymous callers get 401.
- Responses carry `Cache-Control: private, no-store` (branding excepted), `X-Content-Type-Options: nosniff`, and a sandboxing `Content-Security-Policy`. An uploaded file can never run as a page on the app's origin.
- Keys are validated before any disk access: no `..`, no encoded or absolute paths.
- The storage directory can be moved out of `public/` with `FILE_STORAGE_DIR`. It defaults to the old location so existing files and any mounted volume keep working.
- The rental handover route now stores the signature only after confirming that the booking belongs to the caller's tenant, and looks the booking up with an explicit tenant filter.
- Tests: `tests/unit/file-access.test.ts` (26 tests: forged headers, foreign object IDs, cross-tenant, anonymous, portal lessees, traversal keys, response headers).

A signed URL alone would **not** fix this. It proves a link was issued, not that the requester may see the file. Any signed URLs added later must be issued only by `/api/files` after this check, and must be short-lived.

## Exposure assessment (production access needed)

1. **Volume check.** In Railway, open the production and staging web services, then Settings → Volumes, and record any mount path. With no volume, see "When a file was actually reachable" above.
2. **Inventory.** On a host that sees the upload directory, run:
   ```
   DATABASE_URL=<owner connection> FILE_STORAGE_DIR=<upload dir> \
     node scripts/security/uploads-inventory.mjs > uploads-inventory.csv
   ```
   This lists every file with its category, tenant and owning record, plus database links whose file is missing. The script is read-only.
3. **Access logs.** Search the HTTP logs of every period that had a volume for requests to `/uploads/` with status 200. Record the source IPs, user agents and paths. Pay particular attention to:
   - requests without a session cookie;
   - requests from users of a different tenant than the file's owner (compare against the inventory).

   Keep the log extract as evidence. If logs are retained for less time than the volume existed, record that gap. Absence of evidence is not proof of no access.
4. **Decide on notification.** Documents from `leasing/` and `leasing-portal/`, and handover signatures, are personal data. If step 3 shows access from outside the owning tenant, or cannot rule it out for the period, involve whoever handles data protection. They decide whether affected tenants or data subjects must be notified under the UAE PDPL, or any contractual terms. Moving or deleting files does **not** revoke copies already downloaded.
5. **Move files to private storage (follow-up).** Set `FILE_STORAGE_DIR` to a path outside `public/` on the same volume, move the files there (the inventory is the checklist), redeploy, and confirm that old `/uploads/…` links still work through `/api/files`. Object storage (S3 or Azure Blob) replaces this when the UAE hosting move happens.

## Remaining related work

- Exports, server caches and search indexes are part of the wider tenant-isolation audit.
- The leasing-portal session falls back to a hard-coded development secret when `LEASING_PORTAL_SESSION_SECRET`, `SESSION_SECRET` and `AUTH_SECRET` are all unset. Confirm that production sets one of them. Making this fail closed is tracked separately.

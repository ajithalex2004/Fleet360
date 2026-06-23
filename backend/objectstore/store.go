// Package objectstore is the Fleet360 backend's gateway to the configured
// S3-compatible blob store (MinIO in self-hosted dev, AWS S3 or Azure Blob
// via gateway in production).
//
// Why an abstraction package instead of using the MinIO client directly in
// handlers?
//
//   1. Config-from-env in one place. Handlers should never read S3_*
//      env vars — they hand a (key, reader, size, contentType) tuple to
//      this package and don't care where the bytes land.
//   2. Migration safety. If we move from MinIO to AWS S3 (or vice versa)
//      no handler code changes; only the env vars change.
//   3. Testability. Handlers depend on this package's small surface, not
//      on `minio.Client`. Tests for handlers can stub the package.
//
// Configuration:
//
//   S3_ENDPOINT    e.g. s3.amazonaws.com           (AWS)
//                       minio:9000                  (local MinIO compose)
//                       fleet360-store.example.com  (self-hosted MinIO)
//   S3_REGION      e.g. ap-southeast-1
//   S3_ACCESS_KEY  IAM access key / MinIO root user
//   S3_SECRET_KEY  IAM secret key / MinIO root password
//   S3_BUCKET      bucket name — MUST exist; this package does not create it
//   S3_USE_SSL     "true" (default) to use HTTPS; set to "false" for local
//                  MinIO over plain HTTP
//
// All five non-SSL vars are required at startup. Missing any of them is a
// fatal misconfiguration — better to crash on boot than to accept uploads
// that silently disappear.
package objectstore

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// PresignedGetTTL is how long presigned GET URLs returned by
// PresignedGetURL stay valid. 7 days is long enough that a typical UI
// session (open a page, refresh occasionally) doesn't break mid-flight, and
// short enough that a leaked URL stops working before the operator's next
// rotation cycle. Clients that hold attachments long-term must store the
// object key (stable) and re-sign on demand via the /api/files/sign endpoint.
const PresignedGetTTL = 7 * 24 * time.Hour

// Client is the package-level singleton initialised by Init. Handlers use
// the package functions (Put / PresignedGetURL) rather than the *Client
// directly — keeps the surface narrow and stubbable.
type Client struct {
	mc     *minio.Client
	bucket string
}

var pkgClient *Client

// Init reads S3_* env vars, builds a MinIO client, and verifies the bucket
// is reachable. Call once from main() before serving traffic. Returns a
// descriptive error if any env var is missing or the bucket check fails;
// the caller decides whether to log-and-continue (dev) or log.Fatal (prod).
func Init(ctx context.Context) error {
	endpoint := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	accessKey := strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	secretKey := strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	region := strings.TrimSpace(os.Getenv("S3_REGION"))
	useSSL := strings.ToLower(strings.TrimSpace(os.Getenv("S3_USE_SSL"))) != "false"

	if endpoint == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return errors.New("objectstore: required env vars missing — set S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET (and optionally S3_REGION, S3_USE_SSL)")
	}

	mc, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
		Region: region,
	})
	if err != nil {
		return fmt.Errorf("objectstore: client init: %w", err)
	}

	// Verify the bucket exists. A missing bucket is operator error, not
	// runtime error — surface it at boot.
	exists, err := mc.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("objectstore: bucket-exists check failed for %q at %q (region=%q ssl=%v): %w", bucket, endpoint, region, useSSL, err)
	}
	if !exists {
		return fmt.Errorf("objectstore: bucket %q does not exist at %q — create it before deploying", bucket, endpoint)
	}

	pkgClient = &Client{mc: mc, bucket: bucket}
	return nil
}

// Put streams an upload into the bucket under the given key. Caller is
// responsible for choosing a collision-safe key — see DerivedKey for the
// helper handlers should use.
//
// contentType is stored on the object and returned by the bucket on read,
// so a PDF uploaded with contentType="application/pdf" downloads with the
// right MIME (rather than the default application/octet-stream).
func Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	if pkgClient == nil {
		return errors.New("objectstore: not initialised — call Init first")
	}
	_, err := pkgClient.mc.PutObject(ctx, pkgClient.bucket, key, body, size, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("objectstore: put %q (%d bytes): %w", key, size, err)
	}
	return nil
}

// PresignedGetURL returns a time-limited HTTPS URL that grants read access
// to the object at the given key. No auth header is needed; the URL itself
// carries the signature. Clients should NOT store these URLs long-term —
// store the key, request a fresh URL on demand.
//
// Forwards ttl to the underlying SDK directly, so callers can request a
// shorter expiry for one-off display while the default (PresignedGetTTL)
// covers the common case.
func PresignedGetURL(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if pkgClient == nil {
		return "", errors.New("objectstore: not initialised — call Init first")
	}
	if ttl <= 0 {
		ttl = PresignedGetTTL
	}
	// Empty query params — the SDK fills in signature/expires/etc.
	u, err := pkgClient.mc.PresignedGetObject(ctx, pkgClient.bucket, key, ttl, url.Values{})
	if err != nil {
		return "", fmt.Errorf("objectstore: presigned-get %q: %w", key, err)
	}
	return u.String(), nil
}

// DerivedKey returns a collision-safe object key for an uploaded file.
//
// Shape: uploads/YYYY/MM/DD/<unixNanos>-<sanitisedOriginalName>
//
// Date-partitioned because S3 / MinIO list operations get expensive once a
// single prefix carries millions of objects — date partitioning keeps any
// one prefix bounded by daily upload volume. The unixNanos prefix prevents
// collisions when two uploads arrive in the same millisecond. The original
// name is preserved (sanitised) so an operator browsing the bucket can
// identify files at a glance.
func DerivedKey(originalName string, ts time.Time) string {
	clean := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '.', r == '-', r == '_':
			return r
		default:
			// Replace path separators, spaces, unicode, etc. with '_'.
			return '_'
		}
	}, originalName)
	if clean == "" {
		clean = "file"
	}
	return fmt.Sprintf("uploads/%04d/%02d/%02d/%d-%s",
		ts.Year(), ts.Month(), ts.Day(),
		ts.UnixNano(), clean,
	)
}

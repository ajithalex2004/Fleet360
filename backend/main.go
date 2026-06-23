// Fleet360 backend entrypoint.
//
// The binary is dispatched on its first argv to one of two subcommands:
//   serve — boot the HTTP server on :8080 (default; this is what runs in prod)
//   seed  — populate the database with demo data (developer-only operator command)
//
// Why subcommands instead of "just guard seed.Seed() with an env check"?
// Because the production binary's serve path now has NO route to seed code
// at all. A misconfigured GO_ENV, a backup/restore cycle, a fresh install
// on a new tenant — none of them can accidentally inject demo data into a
// real customer database, because the seed function isn't on the serve
// path. Compliance/audit answer becomes structural ("production runs
// `backend serve`, which can't reach seed") rather than configuration
// ("we check an env var").
//
// HTTP surface (versioned, domain-grouped):
//
//   /api/v1/fleet/...        vehicles, drivers, garages
//   /api/v1/maintenance/...  maintenance requests, predictive maintenance
//   /api/v1/service/...      service requests
//   /api/v1/quotations/...   quotations
//   /api/v1/alerts/...       alerts + alert configs
//   /api/v1/files/...        upload, sign (S3-compatible object store)
//
// Dev workflow:
//   go run . serve     (or just `go run .` — defaults to serve)
//   go run . seed      explicit demo-data load
//
// Production deployment should always be: `./backend serve`.
package main

import (
	"context"
	"os"
	"strings"

	"fleet360-backend/auth"
	"fleet360-backend/corsorigin"
	"fleet360-backend/database"
	"fleet360-backend/handlers"
	"fleet360-backend/logging"
	"fleet360-backend/objectstore"
	"fleet360-backend/seed"

	ginzap "github.com/gin-contrib/zap"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"go.uber.org/zap"
)

func main() {
	// All commands need env + DB + logger; loading them here keeps each
	// runX small.
	godotenv.Load()
	logging.Init()
	defer logging.Sync() //nolint:errcheck — known stdout-on-Linux quirk; safe to ignore
	database.Connect()

	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	log := logging.L()
	switch strings.ToLower(cmd) {
	case "serve":
		runServer()
	case "seed":
		runSeed()
	default:
		log.Fatal("unknown command", zap.String("cmd", cmd), zap.String("expected", "serve | seed"))
	}
}

// runServer boots the HTTP server. It does NOT call seed.Seed() — that
// lives in a dedicated subcommand operators invoke explicitly. Production
// deployments invoke this command only, so demo data can never land in a
// real customer database via a misconfigured startup.
func runServer() {
	log := logging.L()
	log.Info("starting HTTP server", zap.String("addr", ":8080"))

	// CORS allow-list: env baseline + tenant-derived (refreshed every minute).
	// Onboarding a new enterprise tenant is an UPDATE on tenants.allowed_origins
	// — no recompile, no container restart, no .env edit. See backend/corsorigin
	// for the merge semantics.
	corsorigin.LoadBaseline()
	if err := corsorigin.RefreshFromDB(database.DB); err != nil {
		log.Warn("CORS initial DB load failed (serving with env baseline only)", zap.Error(err))
	}
	corsorigin.StartRefresher(database.DB, corsorigin.DefaultRefreshInterval)

	// Object store (S3-compatible: AWS S3 in prod, self-hosted MinIO in
	// dev). In production, init failure is fatal — accepting uploads
	// against a broken storage backend is worse than refusing to boot.
	// In dev, init failure logs a warning and the binary continues —
	// developers shouldn't be forced to run MinIO locally just to
	// exercise non-upload endpoints, and Put/PresignedGetURL already
	// return errors when called against an uninitialised client so the
	// failure surfaces clearly at upload time rather than silently.
	if err := objectstore.Init(context.Background()); err != nil {
		if os.Getenv("GO_ENV") == "production" {
			log.Fatal("object store init failed", zap.Error(err))
		}
		log.Warn("object store init failed (non-production, continuing without upload support)",
			zap.String("go_env", os.Getenv("GO_ENV")),
			zap.Error(err),
		)
	} else {
		log.Info("object store ready")
	}

	// Gin in release mode shuts off its colour console banner; structured
	// log lines come from ginzap instead. Production observability tools
	// (Datadog / CloudWatch / ELK / Azure Monitor) prefer the structured
	// shape over Gin's default text format.
	if os.Getenv("GO_ENV") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	// ginzap.Ginzap emits one structured log entry per request.
	// ginzap.RecoveryWithZap catches panics, logs the stack trace, and
	// returns 500 — replaces Gin's default text recovery.
	r.Use(ginzap.Ginzap(log, "", true))
	r.Use(ginzap.RecoveryWithZap(log, true))

	config := cors.DefaultConfig()
	config.AllowOriginFunc = func(origin string) bool { return corsorigin.IsAllowed(origin) }
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	registerV1Routes(r)

	// Static `/uploads` serving was removed when uploads moved to the
	// object store. Pod-local FS reads can't work across replicas, and
	// presigned GET URLs are signed by the bucket — the binary no longer
	// needs to be on the read path at all.

	if err := r.Run(":8080"); err != nil {
		log.Fatal("HTTP server exited with error", zap.Error(err))
	}
}

// registerV1Routes wires the /api/v1/... surface. Grouped by domain rather
// than flat under /api so the deprecation lifecycle of any one resource
// (e.g. retiring v1/quotations in favour of a v2 shape) is self-contained
// — the surrounding domains keep working untouched.
func registerV1Routes(r *gin.Engine) {
	// Every /api/v1/* request must carry a valid Bearer JWT issued by the
	// Next.js login endpoint. auth.Middleware validates the signature,
	// expiry, issuer, and HS256 algorithm, then stuffs the user_id,
	// tenant_id, and role into the gin context. Handlers read those via
	// auth.TenantID(c) / auth.UserID(c) / auth.RoleCode(c) and apply
	// auth.WithTenant(c) as a GORM scope on every query.
	//
	// Unauthenticated requests get 401 with no handler invocation.
	v1 := r.Group("/api/v1", auth.Middleware())

	fleet := v1.Group("/fleet")
	{
		fleet.GET("/vehicles", handlers.GetVehicles)
		fleet.GET("/vehicles/:id", handlers.GetVehicle)
		fleet.POST("/vehicles", handlers.CreateVehicle)
		fleet.PATCH("/vehicles/:id", handlers.UpdateVehicle)
		fleet.DELETE("/vehicles/:id", handlers.DeleteVehicle)
		fleet.GET("/drivers", handlers.GetDrivers)
		fleet.GET("/drivers/:id", handlers.GetDriver)
		fleet.GET("/garages", handlers.GetGarages)
		fleet.POST("/garages", handlers.CreateGarage)
		fleet.PUT("/garages/:id", handlers.UpdateGarage)
	}

	maint := v1.Group("/maintenance")
	{
		maint.GET("/requests", handlers.GetMaintenanceRequests)
		maint.GET("/requests/:id", handlers.GetMaintenanceRequest)
		maint.POST("/requests", handlers.CreateMaintenanceRequest)
		maint.PATCH("/requests/:id", handlers.UpdateMaintenanceRequest)
		// Same URL keeps the frontend cutover atomic with this commit.
		// A follow-up will rename the route to /api/v1/maintenance/alerts.
		maint.GET("/predictive", handlers.GetMaintenanceDueAlerts)
	}

	service := v1.Group("/service")
	{
		service.GET("/requests", handlers.GetServiceRequests)
		service.POST("/requests", handlers.CreateServiceRequest)
		service.PATCH("/requests/:id", handlers.UpdateServiceRequest)
	}

	quotations := v1.Group("/quotations")
	{
		quotations.POST("", handlers.CreateQuotation)
		quotations.PUT("/:id", handlers.UpdateQuotation)
		quotations.PATCH("/:id", handlers.PatchQuotation)
	}

	alerts := v1.Group("/alerts")
	{
		alerts.POST("", handlers.CreateAlert)
		alerts.GET("/configs", handlers.GetAlertConfigs)
		alerts.POST("/configs", handlers.CreateAlertConfig)
		alerts.PATCH("/configs/:id", handlers.UpdateAlertConfig)
		alerts.DELETE("/configs/:id", handlers.DeleteAlertConfig)
	}

	files := v1.Group("/files")
	{
		files.POST("/upload", handlers.UploadFile)
		files.GET("/sign", handlers.GetSignedURL)
	}
}

// runSeed populates the database with demo data via seed.Seed(). Even though
// this command is supposed to be invoked manually (and never by a production
// startup), we keep the GO_ENV gate as belt-and-braces: a developer typing
// `backend seed` against a prod DSN by mistake gets a loud refusal, not a
// silent data dump. Exit code 1 on refusal so CI / scripts can detect it.
func runSeed() {
	log := logging.L()
	env := os.Getenv("GO_ENV")
	switch env {
	case "development", "test":
		log.Info("seeding database", zap.String("go_env", env))
		seed.Seed()
		log.Info("seed done")
	case "production":
		log.Error("refusing to seed a production database", zap.String("go_env", env))
		os.Exit(1)
	default:
		log.Error("refusing to seed: GO_ENV not set to development or test", zap.String("go_env", env))
		os.Exit(1)
	}
}

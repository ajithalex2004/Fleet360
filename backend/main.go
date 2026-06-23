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
//   /api/v1/logistics/...    shipment orders, stats (freight domain; migrating)
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

	"github.com/gin-contrib/cors"
	ginzap "github.com/gin-contrib/zap"
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
		maint.GET("/predictive", handlers.GetPredictiveMaintenance)
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

	// Logistics — the freight/shipment domain migrated out of the Next.js
	// route handlers (src/app/api/logistics) so every query runs behind the
	// same auth.WithTenant scope as the rest of /api/v1. Phase L0 wires the
	// shipment-orders slice + tenant-scoped stats; carriers, bids, RFQs,
	// trips, tracking and finance attach to this group in later phases.
	logistics := v1.Group("/logistics")
	{
		logistics.GET("/shipments", handlers.GetLogisticsShipments)
		logistics.GET("/shipments/:id", handlers.GetLogisticsShipment)
		logistics.POST("/shipments", handlers.CreateLogisticsShipment)
		logistics.GET("/stats", handlers.GetLogisticsStats)

		// Phase L4a — KPI analytics. The Go-native replacement for the Next.js
		// /api/logistics/analytics endpoint, which queries the legacy `bookings`
		// table unscoped (a cross-tenant leak). This computes the same dashboard
		// contract from logistics_shipment_orders behind auth.WithTenant, so each
		// tenant sees only its own shipments. See handlers/logistics_analytics.go.
		logistics.GET("/analytics", handlers.GetLogisticsAnalytics)

		// Phase L4a — SLA monitor for the dispatch board's alert banner.
		// Replaces the Next.js /api/logistics/sla (unscoped legacy-`bookings`
		// scan) with a tenant-scoped pass over active logistics_shipment_orders
		// (delivery-deadline breaches) merged with open SLA-timer exceptions.
		// WARN=2h / BREACH=4h tiers verbatim. The CRITICAL ops SMS/email send is
		// deferred until the sender port lands. See handlers/logistics_sla.go.
		logistics.GET("/sla", handlers.GetLogisticsSla)

		// Phase L4a — driver performance scorecards for the drivers roster and
		// the per-driver performance page. Replaces the Next.js
		// /api/logistics/driver-stats (unscoped legacy-`bookings` scan + a
		// non-existent `phone` column) with a tenant-scoped union of the two
		// driver→shipment link sources — logistics_shipment_orders.assigned_driver_id
		// and logistics_assignments.driver_id — deduped by shipment. Same
		// completion/on-time/no-cancel score; on-time is computed for real rather
		// than the legacy 100% stub. See handlers/logistics_driver_stats.go.
		logistics.GET("/driver-stats", handlers.GetLogisticsDriverStats)

		// Phase L4a — live tracking map feed (polled every 15s). Replaces the
		// Next.js /api/logistics/tracking (unscoped legacy-`bookings` scan with GPS
		// dug out of trip_status_history.note JSON) with a tenant-scoped read of
		// the active logistics_shipment_orders plus a driver_update → epod →
		// estimated GPS fallback sourced from logistics_tracking_events /
		// logistics_pod_events. position is always non-null (estimated Dubai-jitter
		// pin at worst), matching the map's contract. See handlers/logistics_tracking.go.
		logistics.GET("/tracking", handlers.GetLogisticsTracking)

		// Phase L1 — marketplace core: carriers, rate contracts, and the
		// rate-quote engine. The quote endpoint loads tenant-scoped lane
		// candidates and scores them via the pure rateengine package.
		logistics.GET("/carriers", handlers.GetLogisticsCarriers)
		logistics.GET("/carriers/:id", handlers.GetLogisticsCarrier)
		logistics.POST("/carriers", handlers.CreateLogisticsCarrier)
		logistics.GET("/rate-contracts", handlers.GetLogisticsRateContracts)
		logistics.POST("/rate-contracts", handlers.CreateLogisticsRateContract)
		logistics.POST("/rates/quote", handlers.PostLogisticsRateQuote)

		// Spot-market loop: RFQs invite carrier bids; scorecards rank carriers.
		logistics.GET("/rfqs", handlers.GetLogisticsRFQs)
		logistics.POST("/rfqs", handlers.CreateLogisticsRFQ)
		logistics.GET("/bids", handlers.GetLogisticsBids)
		logistics.POST("/bids", handlers.CreateLogisticsBid)
		logistics.GET("/carrier-scorecards", handlers.GetLogisticsCarrierScorecards)
		logistics.POST("/carrier-scorecards", handlers.CreateLogisticsCarrierScorecard)

		// Phase L2 — the trip layer: multi-stop stops, route legs, carrier/
		// driver assignments, GPS tracking, telematics, ePOD, and exceptions.
		// All list/create endpoints scope by ?shipmentOrderId= and run behind
		// auth.WithTenant like the rest of the surface.
		logistics.GET("/stops", handlers.GetLogisticsStops)
		logistics.POST("/stops", handlers.CreateLogisticsStop)
		logistics.GET("/route-legs", handlers.GetLogisticsRouteLegs)
		logistics.POST("/route-legs", handlers.CreateLogisticsRouteLeg)
		logistics.GET("/assignments", handlers.GetLogisticsAssignments)
		logistics.POST("/assignments", handlers.CreateLogisticsAssignment)
		logistics.GET("/tracking-events", handlers.GetLogisticsTrackingEvents)
		logistics.POST("/tracking-events", handlers.CreateLogisticsTrackingEvent)
		logistics.GET("/pod-events", handlers.GetLogisticsPodEvents)
		logistics.POST("/pod-events", handlers.CreateLogisticsPodEvent)
		logistics.GET("/telematics-events", handlers.GetLogisticsTelematicsEvents)
		logistics.POST("/telematics-events", handlers.CreateLogisticsTelematicsEvent)
		logistics.GET("/exceptions", handlers.GetLogisticsExceptions)

		// The headline ingest: a GPS ping that, best-effort, recomputes the
		// shipment ETA and evaluates geofences (raising exception rows). The
		// notify decision is computed but SMS/email sends are deferred until a
		// sender port lands — see handlers/logistics_execution.go.
		logistics.POST("/shipments/:id/tracking", handlers.IngestLogisticsTracking)

		// Finance (Phase L3) — read surface for the money layer plus the 3-way
		// reconciliation report. Write path (post/reverse to the shared ledger)
		// lands in a follow-up increment; see handlers/logistics_finance.go.
		logistics.GET("/freight-charges", handlers.GetLogisticsFreightCharges)
		logistics.GET("/carrier-settlements", handlers.GetLogisticsCarrierSettlements)
		logistics.GET("/driver-payouts", handlers.GetLogisticsDriverPayouts)
		logistics.GET("/finance-postings", handlers.GetLogisticsFinancePostings)
		logistics.GET("/finance/reconciliation", handlers.GetLogisticsFinanceReconciliation)

		// Phase L4c — the VRP route planner. Replaces the Next.js
		// /api/logistics/planner/** routes (raw-SQL, per-call-site tenant filter)
		// with the Go port of route-optimizer-service.ts: optimize a set of
		// shipments across a set of vehicles (pure solver in package routeopt,
		// distance matrix in package distmatrix, geocoding in
		// logistics_geocoder.go), persist the plan DRAFT, then commit / edit /
		// discard / list its lifecycle — every query behind auth.WithTenant.
		planner := logistics.Group("/planner")
		{
			planner.POST("/optimize", handlers.PostLogisticsPlannerOptimize)
			planner.GET("/inputs", handlers.GetLogisticsPlannerInputs)
			planner.GET("/plans", handlers.GetLogisticsPlannerPlans)
			planner.GET("/plans/:id", handlers.GetLogisticsPlannerPlan)
			planner.POST("/plans/:id/commit", handlers.PostLogisticsPlannerCommit)
			planner.POST("/plans/:id/discard", handlers.PostLogisticsPlannerDiscard)
			planner.POST("/plans/:id/edit", handlers.PostLogisticsPlannerEdit)
		}
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

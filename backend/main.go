// Fleet360 backend entrypoint.
//
// The binary is dispatched on its first argv to one of two subcommands:
//   serve — boot the HTTP server on :8080 (default; this is what runs in prod)
//   seed  — populate the database with demo data (developer-only operator command)
//
// Note on the absent "cleanup" subcommand: there used to be a third subcommand
// that hard-deleted maintenance_requests rows with id=''. That subcommand has
// been removed because the underlying problem it patched is now blocked at
// three layers — (1) explicit uuid.New() assignment in the create handler,
// (2) the Model.BeforeCreate GORM hook, and (3) a CHECK("id" <> '')
// constraint at the Postgres level (see prisma/migrations/
// 20260623120000_add_id_not_empty_check_constraints/migration.sql).
// Bad rows can no longer be created, so there is nothing for a cleanup
// command to delete. The enterprise principle is "fix the source of bad
// data, not the symptom" — keeping the cleanup as a subcommand would
// implicitly suggest bad data is expected.
//
// Why subcommands instead of "just guard seed.Seed() with an env check"?
// Because the production binary's serve path now has NO route to seed code at
// all. A misconfigured GO_ENV, a backup/restore cycle, a fresh install on a
// new tenant — none of them can accidentally inject demo data into a real
// customer database, because the seed function isn't on the serve path.
// Compliance/audit answer becomes structural ("production runs `backend serve`,
// which can't reach seed") rather than configuration ("we check an env var").
//
// Dev workflow:
//   go run . serve     (or just `go run .` — defaults to serve)
//   go run . seed      explicit demo-data load
//
// Production deployment should always be: `./backend serve`.
package main

import (
	"log"
	"os"
	"strings"

	"fleet360-backend/database"
	"fleet360-backend/handlers"
	"fleet360-backend/seed"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// All commands need env + DB; loading them here keeps each runX small.
	godotenv.Load()
	database.Connect()

	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	switch strings.ToLower(cmd) {
	case "serve":
		runServer()
	case "seed":
		runSeed()
	default:
		log.Fatalf("unknown command %q — expected: serve | seed", cmd)
	}
}

// runServer boots the HTTP server. It does NOT call seed.Seed() or the
// cleanup delete — those live in dedicated subcommands operators invoke
// explicitly. Production deployments invoke this command only, so demo data
// can never land in a real customer database via a misconfigured startup.
func runServer() {
	log.Println("[serve] starting HTTP server on :8080")

	r := gin.Default()

	// CORS Configuration
	config := cors.DefaultConfig()
	config.AllowOrigins = []string{"http://localhost:3000"}
	config.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	config.AllowHeaders = []string{"Origin", "Content-Type", "Accept", "Authorization"}
	r.Use(cors.New(config))

	// Routes
	api := r.Group("/api")
	{
		api.GET("/vehicles", handlers.GetVehicles)
		api.GET("/vehicles/:id", handlers.GetVehicle)
		api.POST("/vehicles", handlers.CreateVehicle)
		api.PATCH("/vehicles/:id", handlers.UpdateVehicle)
		api.DELETE("/vehicles/:id", handlers.DeleteVehicle)
		api.GET("/maintenance-requests", handlers.GetMaintenanceRequests)
		api.GET("/maintenance-requests/:id", handlers.GetMaintenanceRequest)
		api.POST("/maintenance-requests", handlers.CreateMaintenanceRequest)
		api.PATCH("/maintenance-requests/:id", handlers.UpdateMaintenanceRequest)
		api.GET("/service-requests", handlers.GetServiceRequests)
		api.POST("/service-requests", handlers.CreateServiceRequest)
		api.PATCH("/service-requests/:id", handlers.UpdateServiceRequest)
		api.GET("/drivers", handlers.GetDrivers)
		api.GET("/drivers/:id", handlers.GetDriver)
		api.POST("/quotations", handlers.CreateQuotation)
		api.PUT("/quotations/:id", handlers.UpdateQuotation)
		api.PATCH("/quotations/:id", handlers.PatchQuotation)
		api.GET("/garages", handlers.GetGarages)
		api.POST("/garages", handlers.CreateGarage)
		api.PUT("/garages/:id", handlers.UpdateGarage)
		api.GET("/alert-configs", handlers.GetAlertConfigs)
		api.POST("/alert-configs", handlers.CreateAlertConfig)
		api.PATCH("/alert-configs/:id", handlers.UpdateAlertConfig)
		api.DELETE("/alert-configs/:id", handlers.DeleteAlertConfig)
		api.GET("/maintenance/predictive", handlers.GetPredictiveMaintenance)
		api.POST("/alerts", handlers.CreateAlert)
		api.POST("/upload", handlers.UploadFile)
	}

	// Serve static files from uploads directory
	r.Static("/uploads", "./uploads")

	r.Run(":8080")
}

// runSeed populates the database with demo data via seed.Seed(). Even though
// this command is supposed to be invoked manually (and never by a production
// startup), we keep the GO_ENV gate as belt-and-braces: a developer typing
// `backend seed` against a prod DSN by mistake gets a loud refusal, not a
// silent data dump. Exit code 1 on refusal so CI / scripts can detect it.
func runSeed() {
	env := os.Getenv("GO_ENV")
	switch env {
	case "development", "test":
		log.Printf("[seed] GO_ENV=%q — seeding database", env)
		seed.Seed()
		log.Println("[seed] done")
	case "production":
		log.Println("[seed] GO_ENV=production — refusing to seed a production database")
		os.Exit(1)
	default:
		log.Printf("[seed] GO_ENV=%q (unrecognised or unset) — refusing to seed; set GO_ENV=development or test to allow", env)
		os.Exit(1)
	}
}


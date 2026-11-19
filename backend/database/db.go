package database

import (
	"context"
	"fmt"
	"os"
	"time"

	// "fleet360-backend/models" // Commented out since AutoMigrate is disabled

	"fleet360-backend/logging"

	"go.uber.org/zap"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
	log := logging.L()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "host=localhost user=postgres password=postgres dbname=my_c1_project port=5432 sslmode=disable"
	}

	var err error
	DB, err = gorm.Open(postgres.New(postgres.Config{
		DSN:                  dsn,
		PreferSimpleProtocol: true, // Disables implicit prepared statement usage
	}), &gorm.Config{})
	if err != nil {
		log.Fatal("database connection failed", zap.Error(err))
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Fatal("database pool unavailable", zap.Error(err))
	}
	sqlDB.SetMaxOpenConns(envInt("DB_MAX_OPEN_CONNS", 25))
	sqlDB.SetMaxIdleConns(envInt("DB_MAX_IDLE_CONNS", 10))
	sqlDB.SetConnMaxIdleTime(time.Duration(envInt("DB_CONN_MAX_IDLE_SECONDS", 60)) * time.Second)
	sqlDB.SetConnMaxLifetime(time.Duration(envInt("DB_CONN_MAX_LIFETIME_SECONDS", 300)) * time.Second)
	if err := sqlDB.Ping(); err != nil {
		log.Fatal("database ping failed", zap.Error(err))
	}

	log.Info("database connection established")

	// Auto Migrate
	// Auto Migrate is disabled to prevent conflicts with Prisma schema managed uuid foreign keys.
	/* err = DB.AutoMigrate(
		&models.Vehicle{},
		&models.Driver{},
		&models.Garage{},
		&models.ServiceRequest{},
		&models.MaintenanceRequest{},
		&models.Comment{},
		&models.History{},
		&models.Alert{},
		&models.Invoice{},
		&models.InvoiceLineItem{},
		&models.Quotation{},
		&models.QuotationPart{},
		&models.QuotationLabor{},
		&models.Attachment{},
		&models.AlertConfig{},
	)
	if err != nil {
		log.Fatal("Failed to migrate database:", err)
	} */
	log.Info("database migration skipped (Prisma managed)")
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	var parsed int
	if _, err := fmt.Sscanf(value, "%d", &parsed); err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

// UsePlatformSessionForSeed pins the pool to one connection whose session
// setting app.tenant_id is '*' (the platform context), so the demo seed
// commands can write every tenant's rows into tables under FORCE ROW LEVEL
// SECURITY. For the seed subcommands only, never for the server.
func UsePlatformSessionForSeed() error {
	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	sqlDB.SetConnMaxLifetime(0)
	sqlDB.SetConnMaxIdleTime(0)
	return DB.Exec(`SELECT set_config('app.tenant_id', '*', false)`).Error
}

// WithTenantTx runs fn inside a transaction with transaction-local
// app.tenant_id set via set_config(..., true) so PostgreSQL FORCE ROW LEVEL
// SECURITY policies scope all queries to tenantID. Fails closed if tenantID is empty.
func WithTenantTx(ctx context.Context, tenantID string, fn func(tx *gorm.DB) error) error {
	if tenantID == "" {
		return gorm.ErrInvalidData
	}
	return DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT set_config('app.tenant_id', ?, true)`, tenantID).Error; err != nil {
			return err
		}
		return fn(tx)
	})
}

// WithPlatformTx runs fn inside a transaction with app.tenant_id = '*' for
// pre-authentication lookups (e.g., SCIM token hash resolution, Stripe webhook
// subscription matching) before a single tenantID is known.
func WithPlatformTx(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return WithTenantTx(ctx, "*", fn)
}

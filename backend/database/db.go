package database

import (
	"os"

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

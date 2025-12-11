package database

import (
	"fmt"
	"log"
	"os"

	"my-c1-project-backend/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var DB *gorm.DB

func Connect() {
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
		log.Fatal("Failed to connect to database:", err)
	}

	fmt.Println("Database connection established")

	// Auto Migrate
	err = DB.AutoMigrate(
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
	}
	fmt.Println("Database migrated")
}

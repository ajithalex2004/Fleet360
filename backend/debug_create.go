package main

import (
	"fmt"
	"fleet360-backend/database"
	"fleet360-backend/models"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env
	godotenv.Load()

	// Connect
	database.Connect()

	fmt.Println("Attempting to CREATE vehicle (Simulation)...")

	// Mimic typical payload
	newVehicle := models.Vehicle{
		Make:         "DebugMake",
		VehicleModel: "DebugModel",
		Year:         2025,
		LicensePlate: "DEBUG-999",
		Status:       "Active",
	}

	// 1. Transaction to test DB constraints safely
	tx := database.DB.Begin()
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("!!! PANIC RECOVERED: %v\n", r)
			tx.Rollback()
		}
	}()

	if err := tx.Create(&newVehicle).Error; err != nil {
		fmt.Printf("Error creating vehicle: %v\n", err)
		tx.Rollback()
		return
	}

	fmt.Printf("Successfully created vehicle ID: %s\n", newVehicle.ID)

	// Clean up for this test
	fmt.Println("Rolling back test transaction...")
	tx.Rollback()
	fmt.Println("Done.")
}

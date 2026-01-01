package main

import (
	"fmt"
	"log"
	"my-c1-project-backend/database"
	"my-c1-project-backend/models"

	"github.com/joho/godotenv"
)

func main() {
	// Load .env
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found")
	}

	// Connect to DB
	database.Connect()

	fmt.Println("--- Creating Ghostbusters ---")

	// 1. Count Soft Deleted Vehicles
	var count int64
	if err := database.DB.Unscoped().Model(&models.Vehicle{}).Where("deleted_at IS NOT NULL").Count(&count).Error; err != nil {
		log.Fatalf("Failed to count ghosts: %v", err)
	}
	fmt.Printf("Found %d soft-deleted (ghost) vehicles.\n", count)

	if count > 0 {
		// Get IDs of ghosts
		var ghosts []models.Vehicle
		database.DB.Unscoped().Where("deleted_at IS NOT NULL").Find(&ghosts)

		var ghostIDs []string
		for _, v := range ghosts {
			ghostIDs = append(ghostIDs, v.ID)
		}
		fmt.Printf("Ghost IDs: %v\n", ghostIDs)

		fmt.Println("Cleaning dependencies (Deep Cascade)...")

		// --- Maintenance Requests Cleanup ---
		var ghostMRs []models.MaintenanceRequest
		database.DB.Unscoped().Where("vehicle_id IN ?", ghostIDs).Find(&ghostMRs)
		var mrIDs []string
		for _, mr := range ghostMRs {
			mrIDs = append(mrIDs, mr.ID)
		}

		if len(mrIDs) > 0 {
			fmt.Printf("found %d dependent Maintenance Requests. Cleaning them...\n", len(mrIDs))
			// 1. History
			database.DB.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.History{})
			// 2. Comments
			database.DB.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.Comment{})
			// 3. Attachments
			database.DB.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.Attachment{})
			// 4. Quotations
			database.DB.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.Quotation{})

			// Finally delete MRs
			if err := database.DB.Unscoped().Where("id IN ?", mrIDs).Delete(&models.MaintenanceRequest{}).Error; err != nil {
				log.Printf("Error deleting MRs: %v", err)
			}
		}

		// --- Service Requests Cleanup ---
		var ghostSRs []models.ServiceRequest
		database.DB.Unscoped().Where("vehicle_id IN ?", ghostIDs).Find(&ghostSRs)
		var srIDs []string
		for _, sr := range ghostSRs {
			srIDs = append(srIDs, sr.ID)
		}

		if len(srIDs) > 0 {
			fmt.Printf("found %d dependent Service Requests. Cleaning them...\n", len(srIDs))
			database.DB.Unscoped().Where("service_request_id IN ?", srIDs).Delete(&models.History{})
			database.DB.Unscoped().Where("service_request_id IN ?", srIDs).Delete(&models.Attachment{})

			if err := database.DB.Unscoped().Where("id IN ?", srIDs).Delete(&models.ServiceRequest{}).Error; err != nil {
				log.Printf("Error deleting SRs: %v", err)
			}
		}

		// Drivers (Unassign)
		if err := database.DB.Model(&models.Driver{}).Where("assigned_vehicle_id IN ?", ghostIDs).Update("assigned_vehicle_id", nil).Error; err != nil {
			log.Printf("Warning unassigning drivers: %v", err)
		}

		fmt.Println("Purging ghosts (attempt 3)...")
		if err := database.DB.Unscoped().Where("deleted_at IS NOT NULL").Delete(&models.Vehicle{}).Error; err != nil {
			log.Fatalf("Failed to purge ghosts: %v", err)
		}
		fmt.Println("Ghosts purged successfully.")
	} else {
		fmt.Println("No ghosts found. Database is clean of soft-deletes.")
	}

	// 3. Optional: Delete specific IDs if they exist and are stubborn
	stubbornIDs := []string{"v1", "v2"}
	// Same cascade logic for stubborns
	database.DB.Unscoped().Where("vehicle_id IN ?", stubbornIDs).Delete(&models.MaintenanceRequest{})
	database.DB.Unscoped().Where("vehicle_id IN ?", stubbornIDs).Delete(&models.ServiceRequest{})
	database.DB.Model(&models.Driver{}).Where("assigned_vehicle_id IN ?", stubbornIDs).Update("assigned_vehicle_id", nil)

	if err := database.DB.Unscoped().Where("id IN ?", stubbornIDs).Delete(&models.Vehicle{}).Error; err != nil {
		log.Printf("Failed to force delete seeds: %v", err)
	} else {
		fmt.Println("Ensured v1 and v2 are removed.")
	}

	fmt.Println("--- Cleanup Complete ---")
}

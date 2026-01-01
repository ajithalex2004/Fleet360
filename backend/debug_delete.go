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
	godotenv.Load()

	// Connect
	database.Connect()

	id := "38675a6a-c7da-4817-9aa4-1e460e754b68"
	fmt.Printf("Attempting to delete vehicle: %s\n", id)

	// Mimic Handler Logic
	tx := database.DB.Begin()
	if tx.Error != nil {
		log.Fatalf("Failed to start tx: %v", tx.Error)
	}

	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("!!! PANIC RECOVERED: %v\n", r)
			tx.Rollback()
		}
	}()

	// 1. Find dependent Maintenance Requests
	var mrIDs []string
	if err := tx.Model(&models.MaintenanceRequest{}).Where("vehicle_id = ?", id).Pluck("id", &mrIDs).Error; err != nil {
		fmt.Printf("Error finding MRs: %v\n", err)
	}
	fmt.Printf("Found MRs: %v\n", mrIDs)

	if len(mrIDs) > 0 {
		fmt.Println("Deleting MR dependencies...")
		// History
		if err := tx.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.History{}).Error; err != nil {
			fmt.Printf("Error purging history: %v\n", err)
		}
		// Comments
		if err := tx.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.Comment{}).Error; err != nil {
			fmt.Printf("Error purging comments: %v\n", err)
		}
		// Attachments
		if err := tx.Unscoped().Where("maintenance_request_id IN ?", mrIDs).Delete(&models.Attachment{}).Error; err != nil {
			fmt.Printf("Error purging attachments: %v\n", err)
		}

		// Quotations (Checking for cascade block)
		fmt.Println("Deleting Quotations...")
		// Need to find quotations first to delete THEIR children (Parts/Labor)
		var quoteIDs []string
		tx.Model(&models.Quotation{}).Where("maintenance_request_id IN ?", mrIDs).Pluck("id", &quoteIDs)
		fmt.Printf("Found Quotations: %v\n", quoteIDs)

		if len(quoteIDs) > 0 {
			if err := tx.Unscoped().Where("quotation_id IN ?", quoteIDs).Delete(&models.QuotationPart{}).Error; err != nil {
				fmt.Printf("Error deleting Quote Parts: %v\n", err)
			}
			if err := tx.Unscoped().Where("quotation_id IN ?", quoteIDs).Delete(&models.QuotationLabor{}).Error; err != nil {
				fmt.Printf("Error deleting Quote Labor: %v\n", err)
			}
			if err := tx.Unscoped().Where("id IN ?", quoteIDs).Delete(&models.Quotation{}).Error; err != nil {
				fmt.Printf("Error deleting Quotations table: %v\n", err)
			}
		}

		// Delete MRs
		fmt.Println("Deleting MRs...")
		if err := tx.Unscoped().Where("vehicle_id = ?", id).Delete(&models.MaintenanceRequest{}).Error; err != nil {
			fmt.Printf("Error deleting MRs: %v\n", err)
		}
	}

	// 2. Find dependent Service Requests
	var srIDs []string
	if err := tx.Model(&models.ServiceRequest{}).Where("vehicle_id = ?", id).Pluck("id", &srIDs).Error; err != nil {
		fmt.Printf("Error finding SRs: %v\n", err)
	}
	fmt.Printf("Found SRs: %v\n", srIDs)

	if len(srIDs) > 0 {
		fmt.Println("Deleting SR dependencies...")
		if err := tx.Unscoped().Where("service_request_id IN ?", srIDs).Delete(&models.History{}).Error; err != nil {
			fmt.Printf("Error deleting SR History: %v\n", err)
		}
		if err := tx.Unscoped().Where("service_request_id IN ?", srIDs).Delete(&models.Attachment{}).Error; err != nil {
			fmt.Printf("Error deleting SR Attachments: %v\n", err)
		}
		// Delete SRs
		if err := tx.Unscoped().Where("vehicle_id = ?", id).Delete(&models.ServiceRequest{}).Error; err != nil {
			fmt.Printf("Error deleting SRs: %v\n", err)
		}
	}

	// 3. Unassign Drivers
	fmt.Println("Unassigning Drivers...")
	if err := tx.Model(&models.Driver{}).Where("assigned_vehicle_id = ?", id).Update("assigned_vehicle_id", nil).Error; err != nil {
		fmt.Printf("Error unassigning: %v\n", err)
	}

	// 4. Hard Delete Vehicle
	fmt.Println("Deleting Vehicle...")
	if err := tx.Unscoped().Where("id = ?", id).Delete(&models.Vehicle{}).Error; err != nil {
		fmt.Printf("Error deleting Vehicle: %v\n", err)
		tx.Rollback()
		return
	}

	fmt.Println("Success! Committing...")
	tx.Commit()
	fmt.Println("Done.")
}

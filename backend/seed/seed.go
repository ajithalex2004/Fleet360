package seed

import (
	"fleet360-backend/database"
	"fleet360-backend/logging"
	"fleet360-backend/models"
	"time"

	"go.uber.org/zap"
)

func Seed() {
	log := logging.L()
	// Check if data exists
	var count int64
	database.DB.Model(&models.Vehicle{}).Count(&count)
	if count > 0 {
		log.Info("database already seeded — skipping", zap.Int64("vehicle_count", count))
		return
	}

	log.Info("seeding database")

	// Vehicles
	vehicles := []models.Vehicle{
		{
			Model:              models.Model{ID: "v1"},
			Make:               "Toyota",
			VehicleModel:       "Hilux",
			Type:               "Pickup Truck",
			Year:               2022,
			LicensePlate:       "DXB-12345",
			VIN:                "JTE1234567890",
			CurrentMileage:     45000,
			Status:             "Active",
			RegistrationExpiry: time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC),
			InsuranceExpiry:    time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			Model:              models.Model{ID: "v2"},
			Make:               "Nissan",
			VehicleModel:       "Urvan",
			Type:               "Van",
			Year:               2021,
			LicensePlate:       "DXB-67890",
			VIN:                "JN11234567890",
			CurrentMileage:     82000,
			Status:             "In Service",
			RegistrationExpiry: time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC),
			InsuranceExpiry:    time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC),
		},
	}
	database.DB.Create(&vehicles)

	// Drivers
	v1 := "v1"
	v2 := "v2"
	drivers := []models.Driver{
		{
			Model:             models.Model{ID: "d1"},
			Name:              "Ahmed Al-Farsi",
			LicenseNumber:     "UAE-1234567",
			LicenseExpiry:     time.Date(2026, 5, 10, 0, 0, 0, 0, time.UTC),
			AssignedVehicleID: &v1,
			ContactNumber:     "+971501234567",
		},
		{
			Model:             models.Model{ID: "d2"},
			Name:              "John Smith",
			LicenseNumber:     "UAE-7654321",
			LicenseExpiry:     time.Date(2024, 8, 22, 0, 0, 0, 0, time.UTC),
			AssignedVehicleID: &v2,
			ContactNumber:     "+971559876543",
		},
	}
	database.DB.Create(&drivers)

	// Garages
	garages := []models.Garage{
		{
			Model:         models.Model{ID: "g1"},
			Name:          "AutoPro Service Center",
			Location:      "Al Quoz, Dubai",
			ContactPerson: "Mohammed Ali",
			Designation:   "Service Manager",
			Email:         "mohammed.ali@autopro.ae",
			ContactNumber: "+97141234567",
			IsInternal:    false,
		},
	}
	database.DB.Create(&garages)

	// Service Requests
	serviceRequests := []models.ServiceRequest{
		{
			Model:       models.Model{ID: "SR-1001"},
			RequestorID: "d1",
			ServiceType: "Vehicle Maintenance Service",
			VehicleID:   &v1,
			Priority:    "High",
			Description: "Brake pads need replacement immediately.",
			Date:        time.Date(2025, 11, 24, 0, 0, 0, 0, time.UTC),
			Status:      "Pending",
			History: []models.History{
				{
					Status: models.StatusRequested,
					Date:   time.Date(2025, 11, 24, 0, 0, 0, 0, time.UTC),
					Note:   "Request created",
					Actor:  "System",
				},
			},
		},
		{
			Model:       models.Model{ID: "SR-1004"},
			RequestorID: "u1",
			ServiceType: "Towing & Recovery Service",
			VehicleID:   &v1,
			Priority:    "High",
			Description: "Vehicle broke down on highway",
			Date:        time.Date(2023, 10, 20, 0, 0, 0, 0, time.UTC),
			Status:      "Resolved",
			History: []models.History{
				{
					Status: models.StatusRequested,
					Date:   time.Date(2023, 10, 20, 0, 0, 0, 0, time.UTC),
					Note:   "Request created",
					Actor:  "System",
				},
				{
					Status: models.StatusCompleted,
					Date:   time.Date(2023, 10, 20, 2, 0, 0, 0, time.UTC),
					Note:   "Towing completed",
					Actor:  "Driver",
				},
			},
		},
	}
	database.DB.Create(&serviceRequests)

	log.Info("database seeded successfully")
}

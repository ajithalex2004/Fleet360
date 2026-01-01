package main

import (
	"my-c1-project-backend/database"
	"my-c1-project-backend/handlers"
	"my-c1-project-backend/models"
	"my-c1-project-backend/seed"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
)

func main() {
	// Load .env file
	godotenv.Load()

	// Connect to Database
	database.Connect()

	// Cleanup invalid data
	database.DB.Where("id = ''").Delete(&models.MaintenanceRequest{})

	// Seed Database
	seed.Seed()

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

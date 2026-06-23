package handlers

import (
	"fmt"
	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/models"
	"fleet360-backend/objectstore"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// requireTenant pulls the tenant id from the authenticated request context
// (populated by auth.Middleware on /api/v1) and aborts the request with
// 401 if it's missing. Handlers call this at the top, then either:
//
//   - pass `c` to auth.WithTenant when scoping reads/updates/deletes, OR
//   - set the returned tid on the model's TenantID before db.Create
//
// Returns "" if the request was unauthenticated AND aborts the gin context
// — callers should `return` immediately when this happens.
func requireTenant(c *gin.Context) string {
	tid := auth.TenantID(c)
	if tid == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing tenant context"})
		return ""
	}
	return tid
}

// GetVehicles
func GetVehicles(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var vehicles []models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&vehicles).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, vehicles)
}

// CreateVehicle
func CreateVehicle(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.Vehicle
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Always stamp tenant from the validated token — never trust a
	// client-supplied tenantId field; that would let a token-holder
	// write rows into other tenants.
	input.TenantID = tid

	// Ensure status is valid if not provided (optional)
	if input.Status == "" {
		input.Status = "Active"
	}

	if err := database.DB.Create(&input).Error; err != nil {
		if strings.Contains(err.Error(), "23505") {
			c.JSON(http.StatusConflict, gin.H{"error": "License Plate or VIN already exists."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateVehicle
func UpdateVehicle(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var input models.Vehicle
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var vehicle models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&vehicle).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
		return
	}

	// Prevent client from overriding tenant via the request body —
	// preserve the loaded row's TenantID regardless of what was sent.
	input.TenantID = vehicle.TenantID
	if err := database.DB.Model(&vehicle).Omit("ID", "TenantID").Updates(input).Error; err != nil {
		if strings.Contains(err.Error(), "23505") { // Unique constraint violation
			c.JSON(http.StatusConflict, gin.H{"error": "License Plate or VIN already exists."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, vehicle)
}

// DeleteVehicle
func DeleteVehicle(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")

	// Start atomic transaction for cascade delete. Every nested Pluck /
	// Delete is tenant-scoped — a token-holder from tenant A can't
	// accidentally cascade-delete tenant B's data even if vehicle IDs
	// somehow collided.
	tx := database.DB.Begin()

	// 1. Find dependent Maintenance Requests (this tenant only).
	var mrIDs []string
	tx.Model(&models.MaintenanceRequest{}).Where("tenant_id = ? AND vehicle_id = ?", tid, id).Pluck("id", &mrIDs)

	if len(mrIDs) > 0 {
		// Delete MR dependencies. tenant_id filter is structurally redundant
		// (the maintenance_request_id IN clause already restricts us to this
		// tenant's MRs via the Pluck above) but kept as defence-in-depth.
		if err := tx.Unscoped().Where("tenant_id = ? AND maintenance_request_id IN ?", tid, mrIDs).Delete(&models.History{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete history: " + err.Error()})
			return
		}
		if err := tx.Unscoped().Where("tenant_id = ? AND maintenance_request_id IN ?", tid, mrIDs).Delete(&models.Comment{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete comments: " + err.Error()})
			return
		}
		if err := tx.Unscoped().Where("tenant_id = ? AND maintenance_request_id IN ?", tid, mrIDs).Delete(&models.Attachment{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete attachments: " + err.Error()})
			return
		}
		// Quotations
		if err := tx.Unscoped().Where("tenant_id = ? AND maintenance_request_id IN ?", tid, mrIDs).Delete(&models.Quotation{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete quotations: " + err.Error()})
			return
		}
		// Delete MRs
		if err := tx.Unscoped().Where("tenant_id = ? AND vehicle_id = ?", tid, id).Delete(&models.MaintenanceRequest{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete maintenance requests: " + err.Error()})
			return
		}
	}

	// 2. Find dependent Service Requests
	var srIDs []string
	tx.Model(&models.ServiceRequest{}).Where("tenant_id = ? AND vehicle_id = ?", tid, id).Pluck("id", &srIDs)

	if len(srIDs) > 0 {
		if err := tx.Unscoped().Where("tenant_id = ? AND service_request_id IN ?", tid, srIDs).Delete(&models.History{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete SR history: " + err.Error()})
			return
		}
		if err := tx.Unscoped().Where("tenant_id = ? AND service_request_id IN ?", tid, srIDs).Delete(&models.Attachment{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete SR attachments: " + err.Error()})
			return
		}
		// Delete SRs
		if err := tx.Unscoped().Where("tenant_id = ? AND vehicle_id = ?", tid, id).Delete(&models.ServiceRequest{}).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete service requests: " + err.Error()})
			return
		}
	}

	// 3. Unassign Drivers (this tenant's drivers only)
	if err := tx.Model(&models.Driver{}).Where("tenant_id = ? AND assigned_vehicle_id = ?", tid, id).Update("assigned_vehicle_id", nil).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to unassign drivers: " + err.Error()})
		return
	}

	// 4. Finally, Hard Delete the Vehicle (this tenant only)
	if err := tx.Unscoped().Where("tenant_id = ? AND id = ?", tid, id).Delete(&models.Vehicle{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	tx.Commit()
	c.Status(http.StatusNoContent)
}

// GetMaintenanceRequests
func GetMaintenanceRequests(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var requests []models.MaintenanceRequest
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Preload("Vehicle").
		Preload("Driver").
		Preload("Garage").
		Preload("History").
		Preload("Quotations").
		Find(&requests).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, requests)
}

// GetMaintenanceRequest
func GetMaintenanceRequest(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var request models.MaintenanceRequest
	// Preload all associations needed for the details page
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Preload("Vehicle").
		Preload("Driver").
		Preload("Garage").
		Preload("History").
		Preload("Quotations").
		Preload("Quotations.Garage").
		Preload("Quotations.Parts").
		Preload("Quotations.Labor").
		Preload("Quotations.Attachments").
		Preload("Quotations.Labor").
		Preload("Quotations.Attachments").
		Preload("Attachments").
		First(&request, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Maintenance request not found"})
		return
	}
	c.JSON(http.StatusOK, request)
}

// CreateMaintenanceRequest
func CreateMaintenanceRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.MaintenanceRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Stamp tenant from validated token. Cascading History rows
	// (created below) inherit the same tenant.
	input.TenantID = tid

	// Belt-and-braces: the Model.BeforeCreate hook (models.go) is the primary
	// guarantee that every row gets a UUID, but we set it here explicitly so a
	// future refactor that swaps db.Create for a raw insert / batch helper /
	// upsert (none of which fire GORM hooks) can't silently regress to id=''
	// rows. Same reason we do it for History below.
	if input.ID == "" {
		input.ID = uuid.New().String()
	}

	// Ensure status is valid if not provided
	if input.Status == "" {
		input.Status = models.StatusRequested
	}

	// Add initial history. tenant_id mirrors the parent — never resolve it
	// from the JWT here directly so a refactor that detaches history from
	// the parent can't silently land it in a different tenant.
	input.History = []models.History{
		{
			Model:    models.Model{ID: uuid.New().String()},
			TenantID: tid,
			Status:   models.StatusRequested,
			Date:     input.RequestDate,
			Note:     "Request created",
			Actor:    "System", // In a real app, get from context/JWT
		},
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateMaintenanceRequest
func UpdateMaintenanceRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")
	var input models.MaintenanceRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var request models.MaintenanceRequest
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&request).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Maintenance request not found"})
		return
	}

	// Capture old status to check for changes
	oldStatus := request.Status

	// Update fields. Preserve TenantID — client must not be able to
	// re-parent a row into another tenant via a forged request body.
	input.TenantID = request.TenantID
	if err := database.DB.Model(&request).Omit("ID", "TenantID").Updates(input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Logic to append History if Status changed
	// Note: We use the input.Status if it was provided, otherwise GORM Updates might strictly use fields present in JSON
	// Since we bound to 'input', check if input.Status is non-empty and different
	if input.Status != "" && input.Status != oldStatus {
		newHistory := models.History{
			TenantID:             tid,
			MaintenanceRequestID: &request.ID,
			Status:               input.Status,
			Date:                 time.Now(),
			Note:                 fmt.Sprintf("Status updated to %s", input.Status),
			Actor:                "System",
		}
		database.DB.Create(&newHistory)
	}

	// Explicitly replace associations if provided
	if len(input.Attachments) > 0 {
		fmt.Printf("[DEBUG] Updating Attachments for Request %s. Count: %d\n", request.ID, len(input.Attachments))
		for i, att := range input.Attachments {
			fmt.Printf("  [%d] ID: %s, URL: %s, Type: %s\n", i, att.ID, att.URL, att.Type)
		}
		if err := database.DB.Model(&request).Association("Attachments").Replace(input.Attachments); err != nil {
			fmt.Printf("[ERROR] Failed to replace attachments: %v\n", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update attachments: " + err.Error()})
			return
		}
		fmt.Println("[DEBUG] Attachments updated successfully")
	} else {
		fmt.Printf("[DEBUG] No attachments to update (Input len=0)\n")
	}

	if len(input.Quotations) > 0 {
		if err := database.DB.Model(&request).Association("Quotations").Replace(input.Quotations); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update quotations: " + err.Error()})
			return
		}
	}

	// Return the updated request (reload to get fresh data including history)
	database.DB.Scopes(auth.WithTenant(c)).Preload("Vehicle").Preload("Driver").Preload("Garage").Preload("History").Preload("Attachments").First(&request)

	c.JSON(http.StatusOK, request)
}

// GetServiceRequests
func GetServiceRequests(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var requests []models.ServiceRequest
	if err := database.DB.Scopes(auth.WithTenant(c)).Preload("History").Find(&requests).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, requests)
}

// GetDrivers
func GetDrivers(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var drivers []models.Driver
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&drivers).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, drivers)
}

// GetDriver
func GetDriver(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var driver models.Driver
	if err := database.DB.Scopes(auth.WithTenant(c)).First(&driver, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Driver not found"})
		return
	}
	c.JSON(http.StatusOK, driver)
}

// GetVehicle
func GetVehicle(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var vehicle models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).First(&vehicle, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Vehicle not found"})
		return
	}
	c.JSON(http.StatusOK, vehicle)
}

// CreateServiceRequest
func CreateServiceRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.ServiceRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TenantID = tid

	// Add initial history. tenant_id mirrors parent.
	input.History = []models.History{
		{
			TenantID: tid,
			Status:   "Pending",
			Date:     input.Date,
			Note:     "Service Request Created",
			Actor:    "System",
		},
	}

	// Ensure status is Pending
	input.Status = "Pending"

	// Generate ID explicitly to avoid GORM hook conflicts.
	// Scope the "last seq" lookup to this tenant so SR sequences don't
	// collide across customers.
	if input.ID == "" {
		currentYear := time.Now().Format("06")
		prefix := "SR" + currentYear
		var lastRequest models.ServiceRequest
		// Find last request, ignoring error (if not found, start at 1001)
		database.DB.Scopes(auth.WithTenant(c)).Where("id LIKE ?", prefix+"%").Order("id desc").First(&lastRequest)

		nextSeq := 1001
		if lastRequest.ID != "" && len(lastRequest.ID) >= 8 {
			lastSeqStr := lastRequest.ID[4:] // Skip "SR25"
			if lastSeq, err := strconv.Atoi(lastSeqStr); err == nil {
				nextSeq = lastSeq + 1
			}
		}
		input.ID = fmt.Sprintf("%s%d", prefix, nextSeq)
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateServiceRequest
func UpdateServiceRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")
	var input models.ServiceRequest
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var request models.ServiceRequest
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&request).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Service request not found"})
		return
	}

	oldStatus := request.Status

	// Preserve tenant on update
	input.TenantID = request.TenantID
	if err := database.DB.Model(&request).Omit("ID", "TenantID").Updates(input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Capture history for status change. tenant_id mirrors the parent.
	if input.Status != "" && input.Status != oldStatus {
		newHistory := models.History{
			TenantID:         tid,
			ServiceRequestID: &request.ID,
			// Status field in History is typed MaintenanceStatus, but ServiceRequest status is string.
			// Casting or mapping might be needed. For now assuming strictly compatible string.
			Status: models.MaintenanceStatus(input.Status),
			Date:   time.Now(),
			Note:   fmt.Sprintf("Status updated to %s", input.Status),
			Actor:  "System",
		}
		database.DB.Create(&newHistory)
	}

	c.JSON(http.StatusOK, request)
}

// CreateQuotation
func CreateQuotation(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.Quotation
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TenantID = tid

	// Default status if not provided
	if input.Status == "" {
		input.Status = models.QuotationStatusPending
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateQuotation
func UpdateQuotation(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")
	var input models.Quotation
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Start atomic transaction
	tx := database.DB.Begin()

	// 1. Verify existence (scoped to this tenant — can't fetch another
	// tenant's quotation even by guessing the id).
	var existing models.Quotation
	if err := tx.Scopes(auth.WithTenant(c)).First(&existing, "id = ?", id).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusNotFound, gin.H{"error": "Quotation not found"})
		return
	}

	// 2. Clear existing Parts and Labor for replacement.
	// QuotationPart / QuotationLabor inherit ownership via quotation_id,
	// which is already restricted to this tenant by the existence check
	// above — no separate tenant_id columns on those child tables.
	if err := tx.Where("quotation_id = ?", id).Delete(&models.QuotationPart{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear existing parts"})
		return
	}
	if err := tx.Where("quotation_id = ?", id).Delete(&models.QuotationLabor{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear existing labor"})
		return
	}
	// Preserve TenantID on the input from the existing record.
	input.TenantID = existing.TenantID
	_ = tid // tid is captured in `auth.WithTenant(c)` scope; reference for future use

	// 3. Update main fields and associations
	// Re-assign ID to parts/labor to ensure link and CLEAR IDs to force creation
	for i := range input.Parts {
		input.Parts[i].QuotationID = id
		input.Parts[i].ID = "" // Force creation
	}
	for i := range input.Labor {
		input.Labor[i].QuotationID = id
		input.Labor[i].ID = "" // Force creation
	}

	// Increment Revision
	input.Revision = existing.Revision + 1

	// Save updates (including nested associations given GORM's behavior with full save)
	if err := tx.Save(&input).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update quotation"})
		return
	}

	tx.Commit()
	c.JSON(http.StatusOK, input)
}

// GetGarages
func GetGarages(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var garages []models.Garage
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&garages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, garages)
}

// PatchQuotation
func PatchQuotation(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var input models.Quotation
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var quotation models.Quotation
	if err := database.DB.Scopes(auth.WithTenant(c)).First(&quotation, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Quotation not found"})
		return
	}

	// Preserve TenantID on partial update
	input.TenantID = quotation.TenantID
	if err := database.DB.Model(&quotation).Omit("TenantID").Updates(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, quotation)
}

// CreateGarage
func CreateGarage(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.Garage
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TenantID = tid

	// Force new UUID to avoid collisions
	fmt.Printf("[Update] Creating Garage with Input ID: %s (Replacing with new UUID)\n", input.ID)
	input.ID = uuid.New().String()

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateGarage
func UpdateGarage(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var input models.Garage
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var garage models.Garage
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&garage).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Garage not found"})
		return
	}

	// Preserve TenantID on update
	input.TenantID = garage.TenantID
	if err := database.DB.Model(&garage).Omit("ID", "TenantID").Updates(input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, garage)
}

// GetPredictiveMaintenance (Heuristic Engine)
func GetPredictiveMaintenance(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var vehicles []models.Vehicle
	// Try to fetch this tenant's vehicles. Predictive maintenance must
	// only consider the requesting tenant's fleet — leaking another
	// tenant's mileage data would be a side-channel data leak via
	// statistical inference.
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&vehicles).Error; err != nil {
		fmt.Printf("Error fetching vehicles for predictive maintenance: %v\n", err)
		// Proceed with empty list instead of 500
		vehicles = []models.Vehicle{}
	}

	var predictions []models.Prediction

	for _, v := range vehicles {
		// Heuristic 1: High Mileage -> Brake Pads
		if v.CurrentMileage > 50000 {
			predictions = append(predictions, models.Prediction{
				VehicleID:            v.ID,
				VehicleName:          v.Make + " " + v.VehicleModel + " (" + v.LicensePlate + ")",
				Component:            "Brake Pads",
				CurrentCondition:     35, // Simulated degradation
				PredictedFailureDate: "2025-01-20",
				Confidence:           85,
				RecommendedAction:    "Inspect and replace brake pads",
				EstimatedCost:        450.00,
				RiskLevel:            "High",
			})
		}

		// Heuristic 2: Medium Mileage -> Tires
		if v.CurrentMileage > 30000 && v.CurrentMileage <= 50000 {
			predictions = append(predictions, models.Prediction{
				VehicleID:            v.ID,
				VehicleName:          v.Make + " " + v.VehicleModel + " (" + v.LicensePlate + ")",
				Component:            "Tires",
				CurrentCondition:     60,
				PredictedFailureDate: "2025-03-15",
				Confidence:           70,
				RecommendedAction:    "Check tire tread depth",
				EstimatedCost:        800.00,
				RiskLevel:            "Medium",
			})
		}

		// Heuristic 3: Old Vehicle -> Battery
		if v.Year < 2022 {
			predictions = append(predictions, models.Prediction{
				VehicleID:            v.ID,
				VehicleName:          v.Make + " " + v.VehicleModel + " (" + v.LicensePlate + ")",
				Component:            "Battery",
				CurrentCondition:     40,
				PredictedFailureDate: "2025-02-10",
				Confidence:           90,
				RecommendedAction:    "Test battery health",
				EstimatedCost:        250.00,
				RiskLevel:            "High",
			})
		}
	}

	// Dynamic Optimization Logic
	var highRiskDates []time.Time
	layout := "2006-01-02"

	for _, p := range predictions {
		if p.RiskLevel == "High" {
			t, err := time.Parse(layout, p.PredictedFailureDate)
			if err == nil {
				highRiskDates = append(highRiskDates, t)
			}
		}
	}

	// Sort dates to find earliest failure
	sort.Slice(highRiskDates, func(i, j int) bool {
		return highRiskDates[i].Before(highRiskDates[j])
	})

	var opt models.Optimization
	if len(highRiskDates) > 0 {
		earliest := highRiskDates[0]
		opt.EarliestFailure = earliest.Format("Jan 02")

		// Optimal: 14 to 7 days before failure
		startOpt := earliest.AddDate(0, 0, -14)
		endOpt := earliest.AddDate(0, 0, -7)
		opt.OptimalWindow = fmt.Sprintf("%s - %s", startOpt.Format("Jan 02"), endOpt.Format("Jan 02"))
		opt.OptimalReason = "Lowest cost period with minimal disruption"

		// Alt: 7 to 0 days before failure
		startAlt := earliest.AddDate(0, 0, -7)
		endAlt := earliest.AddDate(0, 0, 0)
		opt.AltWindow = fmt.Sprintf("%s - %s", startAlt.Format("Jan 02"), endAlt.Format("Jan 02"))
		opt.AltReason = "Just-in-time replacement (High Risk)"
	} else {
		// Default / No Risk
		opt.OptimalWindow = "Maintenance Up-to-Date"
		opt.OptimalReason = "No critical actions needed"
		opt.AltWindow = "Review Monthly"
		opt.AltReason = "Standard schedule"
		opt.EarliestFailure = "-"
	}

	// Cost Forecast & Risk Assessment Logic
	// Initialize with zero values to ensure JSON output is valid object, not null
	cost := models.CostForecast{
		Trend: "stable",
	}
	risk := models.RiskAssessment{}

	now := time.Now()

	for _, p := range predictions {
		// Risk Counts (excluding duplicates if any, but simplistic count here)
		if p.RiskLevel == "High" {
			risk.Critical++
		} else if p.RiskLevel == "Medium" {
			risk.Warning++
		}

		// Cost Buckets
		t, err := time.Parse(layout, p.PredictedFailureDate)
		if err == nil {
			daysUntil := int(t.Sub(now).Hours() / 24)

			if daysUntil <= 30 {
				cost.CurrentMonth += p.EstimatedCost
			}
			if daysUntil > 30 && daysUntil <= 60 {
				cost.NextMonth += p.EstimatedCost
			}
			if daysUntil <= 90 {
				cost.Next3Months += p.EstimatedCost
			}
			if daysUntil <= 180 {
				cost.Next6Months += p.EstimatedCost
			}
		}
	}

	// Calculate "Healthy" = Total Vehicles - (Critical + Warning)
	// Ensuring no negative values if logic overlaps
	riskyCount := risk.Critical + risk.Warning
	if len(vehicles) >= riskyCount {
		risk.Healthy = len(vehicles) - riskyCount
	} else {
		risk.Healthy = 0
	}

	// Simple Trend Logic
	if cost.NextMonth > cost.CurrentMonth {
		cost.Trend = "increasing"
	} else if cost.NextMonth < cost.CurrentMonth {
		cost.Trend = "decreasing"
	}

	c.JSON(http.StatusOK, models.PredictiveSummary{
		Predictions:    predictions,
		Optimization:   opt,
		CostForecast:   cost,
		RiskAssessment: risk,
	})
}

// GetAlertConfigs
func GetAlertConfigs(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	var configs []models.AlertConfig
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&configs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, configs)
}

// CreateAlertConfig
func CreateAlertConfig(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.AlertConfig
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TenantID = tid

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

// UpdateAlertConfig
func UpdateAlertConfig(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	var input models.AlertConfig
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var config models.AlertConfig
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).First(&config).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Alert Config not found"})
		return
	}

	input.TenantID = config.TenantID
	if err := database.DB.Model(&config).Omit("ID", "TenantID").Updates(input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Fetch updated (scoped — a same-id row in another tenant would never load)
	database.DB.Scopes(auth.WithTenant(c)).First(&config, "id = ?", id)
	c.JSON(http.StatusOK, config)
}

// DeleteAlertConfig
func DeleteAlertConfig(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	id := c.Param("id")
	if err := database.DB.Scopes(auth.WithTenant(c)).Where("id = ?", id).Delete(&models.AlertConfig{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// UploadFile streams the incoming multipart upload to the configured S3-
// compatible object store (MinIO in self-hosted dev, AWS S3 / Azure Blob in
// prod) and returns a presigned GET URL for immediate display alongside
// the stable object key for long-term storage.
//
// Why both `url` and `objectKey` in the response?
//
//   - `objectKey` is stable and belongs in the database. The frontend
//     stores it on the attachment / vehicle / driver row.
//   - `url` is a presigned GET valid for 7 days (objectstore.PresignedGetTTL).
//     Use it for the immediate response render. For long-lived UIs, call
//     GET /api/files/sign?key={objectKey} to refresh on demand.
//
// This contract decouples URL lifetime from row lifetime, which is the
// enterprise pattern AWS, Samsara, Geotab et al. use.
func UploadFile(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file is received"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Unable to read uploaded file"})
		return
	}
	defer src.Close()

	// MIME from the client is advisory but we forward it so the bucket
	// serves the right Content-Type on download. If the client lies, the
	// browser's response handler is the one fooled — the object store
	// itself is content-agnostic.
	contentType := file.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	key := objectstore.DerivedKey(file.Filename, time.Now().UTC())

	if err := objectstore.Put(c.Request.Context(), key, src, file.Size, contentType); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("Object store write failed: %v", err)})
		return
	}

	signedURL, err := objectstore.PresignedGetURL(c.Request.Context(), key, objectstore.PresignedGetTTL)
	if err != nil {
		// Upload succeeded but signing failed. Surface the key so the
		// caller can retry signing via /api/files/sign rather than
		// re-uploading.
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":     fmt.Sprintf("Upload succeeded but URL signing failed: %v", err),
			"objectKey": key,
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":   "File uploaded successfully",
		"url":       signedURL,
		"objectKey": key,
		"fileName":  file.Filename,
	})
}

// GetSignedURL returns a fresh presigned GET URL for the given object key.
// Frontend stores the stable `objectKey` returned by UploadFile in the
// database and calls this endpoint when it needs a usable URL.
//
//   GET /api/files/sign?key=uploads/2026/06/23/172000000-invoice.pdf
//
// 400 if `key` is missing or has the wrong shape (must start with
// "uploads/" to prevent callers requesting URLs for arbitrary keys outside
// our naming scheme — defence-in-depth against future bucket layouts that
// hold non-public objects under different prefixes).
func GetSignedURL(c *gin.Context) {
	key := strings.TrimSpace(c.Query("key"))
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key query parameter required"})
		return
	}
	if !strings.HasPrefix(key, "uploads/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key must reference an uploaded asset"})
		return
	}

	signedURL, err := objectstore.PresignedGetURL(c.Request.Context(), key, objectstore.PresignedGetTTL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("sign failed: %v", err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"url":       signedURL,
		"objectKey": key,
	})
}

// CreateAlert
func CreateAlert(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	var input models.Alert
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	input.TenantID = tid

	// Default status if missing
	if input.Status == "" {
		input.Status = models.ActionStatus("PENDING")
	}
	// Default date if missing
	if input.DateCreated.IsZero() {
		input.DateCreated = time.Now()
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, input)
}

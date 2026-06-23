package handlers

import (
	"fmt"
	"fleet360-backend/analytics"
	"fleet360-backend/auth"
	"fleet360-backend/database"
	"fleet360-backend/logging"
	"fleet360-backend/models"
	"fleet360-backend/objectstore"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
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
	log := logging.L()
	if len(input.Attachments) > 0 {
		log.Debug("updating attachments",
			zap.String("request_id", request.ID),
			zap.Int("count", len(input.Attachments)),
		)
		if err := database.DB.Model(&request).Association("Attachments").Replace(input.Attachments); err != nil {
			log.Error("failed to replace attachments",
				zap.String("request_id", request.ID),
				zap.Error(err),
			)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update attachments: " + err.Error()})
			return
		}
		log.Debug("attachments updated successfully", zap.String("request_id", request.ID))
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
	logging.L().Debug("creating garage with fresh UUID (replacing client-supplied ID)",
		zap.String("client_supplied_id", input.ID),
	)
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

// GetMaintenanceDueAlerts returns "this vehicle is due for service"
// recommendations for the requesting tenant. Two complementary signals
// feed the alert list:
//
//  1. Rule-based triggers (Phase 1): mileage/age thresholds. Catch
//     vehicles with no maintenance history yet — useful for the new-
//     fleet case where there's nothing to extrapolate from.
//
//  2. History-based projections (Phase 2): per-vehicle interval analytics
//     from completed maintenance_requests rows. Catch vehicles where the
//     thresholds would miss the actual due date — e.g., a low-mileage
//     vehicle whose brake pads are due based on its own service cadence.
//
// Every alert carries a Source field declaring which signal produced it
// (and whether both corroborated), plus the SampleCount the analytics
// were based on. No fake confidence numbers anywhere.
//
// Endpoint URL stays at /api/v1/maintenance/predictive for one release
// so the frontend cuts over atomically. A follow-up will rename the route
// to /api/v1/maintenance/alerts once consumers have migrated.
func GetMaintenanceDueAlerts(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	now := time.Now()

	var vehicles []models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).Find(&vehicles).Error; err != nil {
		logging.L().Warn("failed to fetch vehicles for maintenance-due alerts, proceeding with empty list",
			zap.String("tenant_id", auth.TenantID(c)),
			zap.Error(err),
		)
		vehicles = []models.Vehicle{}
	}

	// Load completed maintenance requests for this tenant. We only need
	// the four columns the analytics package consumes — keep the query
	// narrow so it scales as history grows. Filter on the two completion
	// statuses + non-null completion_date so the analytics doesn't
	// regress to in-flight requests.
	type completedRow struct {
		VehicleID       string
		MaintenanceType string
		Odometer        int
		CompletionDate  time.Time
	}
	var rows []completedRow
	if err := database.DB.
		Scopes(auth.WithTenant(c)).
		Model(&models.MaintenanceRequest{}).
		Select("vehicle_id, maintenance_type, odometer, completion_date").
		Where("status IN ?", []string{string(models.StatusCompleted), string(models.StatusMaintenanceCompleted)}).
		Where("completion_date IS NOT NULL").
		Where("maintenance_type <> ''").
		Find(&rows).Error; err != nil {
		logging.L().Warn("failed to fetch maintenance history for analytics, proceeding without it",
			zap.String("tenant_id", auth.TenantID(c)),
			zap.Error(err),
		)
		rows = nil
	}

	events := make([]analytics.ServiceEvent, 0, len(rows))
	for _, r := range rows {
		events = append(events, analytics.ServiceEvent{
			VehicleID:       r.VehicleID,
			MaintenanceType: r.MaintenanceType,
			Odometer:        r.Odometer,
			CompletedAt:     r.CompletionDate,
		})
	}
	grouped := analytics.GroupByVehicleAndType(events)

	// Build a lookup of vehicle id → vehicle for the analytics path so
	// we can attach VehicleName / mileage / year to history-driven alerts
	// without re-iterating vehicles.
	vehicleByID := make(map[string]*models.Vehicle, len(vehicles))
	for i := range vehicles {
		vehicleByID[vehicles[i].ID] = &vehicles[i]
	}

	// alertKey dedupes alerts by (vehicleID, component). The first one
	// to land wins; subsequent contributions enrich it (e.g. analytics
	// data added to an alert originally produced by a rule).
	alertKey := func(vehicleID, component string) string { return vehicleID + "|" + component }
	alertByKey := map[string]*models.MaintenanceDueAlert{}
	orderedKeys := []string{} // preserve discovery order so output is deterministic

	addAlert := func(a models.MaintenanceDueAlert) {
		k := alertKey(a.VehicleID, a.Component)
		if existing, ok := alertByKey[k]; ok {
			// Enrich: copy any non-zero analytics fields from the new
			// alert onto the existing one, and bump Source to declare
			// both signals corroborated.
			if a.SampleCount > 0 && existing.SampleCount == 0 {
				existing.SampleCount = a.SampleCount
				existing.TypicalIntervalKm = a.TypicalIntervalKm
				existing.TypicalIntervalDays = a.TypicalIntervalDays
				existing.LastServiceAt = a.LastServiceAt
				existing.LastServiceOdometer = a.LastServiceOdometer
				existing.ProjectedDueAtKm = a.ProjectedDueAtKm
				existing.ProjectedDueByDate = a.ProjectedDueByDate
			}
			if existing.Source == "rule" && a.Source == "history" {
				existing.Source = "rule+history"
				// Append the analytics reason to the rule's reason so
				// the UI shows both why the rule fired and what the
				// history says.
				existing.Reason = existing.Reason + "; " + a.Reason
			}
			return
		}
		alertByKey[k] = &a
		orderedKeys = append(orderedKeys, k)
	}

	currentYear := now.Year()

	// ── Pass 1: history-driven projections ───────────────────────────
	// For every (vehicle, type) bucket with enough data, project the
	// next-due milestone. Generate an alert only when the projection
	// says overdue or due_soon — anything on_schedule stays quiet.
	for vehicleID, byType := range grouped {
		v := vehicleByID[vehicleID]
		if v == nil {
			// Vehicle was deleted or filtered out; skip the orphan
			// history rows.
			continue
		}
		name := strings.TrimSpace(v.Make + " " + v.VehicleModel + " (" + v.LicensePlate + ")")

		for maintType, typeEvents := range byType {
			stats, ok := analytics.ComputeIntervalStats(typeEvents)
			if !ok {
				continue
			}
			proj := analytics.ProjectNextDue(stats, v.CurrentMileage, now)
			if proj.Status == "on_schedule" {
				continue
			}

			risk := "Medium"
			if proj.Status == "overdue" {
				risk = "High"
			}

			lastAt := stats.LastServiceAt
			dueBy := proj.NextDueByDate
			reason := fmt.Sprintf(
				"projected from %d prior services — typical interval %d km / %d days, last service at %d km on %s",
				stats.SampleCount, stats.MeanKm, stats.MeanDays, stats.LastOdometer, stats.LastServiceAt.Format("2006-01-02"),
			)

			addAlert(models.MaintenanceDueAlert{
				VehicleID:           v.ID,
				VehicleName:         name,
				Component:           maintType,
				RecommendedAction:   fmt.Sprintf("Schedule %s service", strings.ToLower(maintType)),
				RiskLevel:           risk,
				Reason:              reason,
				VehicleMileage:      v.CurrentMileage,
				VehicleYear:         v.Year,
				Source:              "history",
				SampleCount:         stats.SampleCount,
				TypicalIntervalKm:   stats.MeanKm,
				TypicalIntervalDays: stats.MeanDays,
				LastServiceAt:       &lastAt,
				LastServiceOdometer: stats.LastOdometer,
				ProjectedDueAtKm:    proj.NextDueAtKm,
				ProjectedDueByDate:  &dueBy,
			})
		}
	}

	// ── Pass 2: rule-based triggers ──────────────────────────────────
	// Same three rules as Phase 1. addAlert merges with any history-
	// driven alert for the same (vehicle, component) pair, so the final
	// output is naturally deduplicated.
	for _, v := range vehicles {
		name := strings.TrimSpace(v.Make + " " + v.VehicleModel + " (" + v.LicensePlate + ")")

		if v.CurrentMileage > 50000 {
			addAlert(models.MaintenanceDueAlert{
				VehicleID:         v.ID,
				VehicleName:       name,
				Component:         "Brake Pads",
				RecommendedAction: "Inspect brake pads and discs",
				RiskLevel:         "High",
				Reason:            fmt.Sprintf("mileage %d km exceeds 50,000 km threshold", v.CurrentMileage),
				VehicleMileage:    v.CurrentMileage,
				VehicleYear:       v.Year,
				Source:            "rule",
			})
		}

		if v.CurrentMileage > 30000 && v.CurrentMileage <= 50000 {
			addAlert(models.MaintenanceDueAlert{
				VehicleID:         v.ID,
				VehicleName:       name,
				Component:         "Tires",
				RecommendedAction: "Check tire tread depth and rotation",
				RiskLevel:         "Medium",
				Reason:            fmt.Sprintf("mileage %d km in 30,000–50,000 km range", v.CurrentMileage),
				VehicleMileage:    v.CurrentMileage,
				VehicleYear:       v.Year,
				Source:            "rule",
			})
		}

		if v.Year > 0 && currentYear-v.Year >= 3 {
			addAlert(models.MaintenanceDueAlert{
				VehicleID:         v.ID,
				VehicleName:       name,
				Component:         "Battery",
				RecommendedAction: "Test battery health and charge level",
				RiskLevel:         "High",
				Reason:            fmt.Sprintf("vehicle is %d years old (year %d)", currentYear-v.Year, v.Year),
				VehicleMileage:    v.CurrentMileage,
				VehicleYear:       v.Year,
				Source:            "rule",
			})
		}
	}

	// Flatten the dedup map into the deterministic order we discovered
	// alerts in (history first, then rule additions for components
	// without a history-driven alert).
	alerts := make([]models.MaintenanceDueAlert, 0, len(alertByKey))
	for _, k := range orderedKeys {
		alerts = append(alerts, *alertByKey[k])
	}

	// Risk rollup: dedupe vehicles by id, respecting risk-level
	// precedence (any "High" alert puts the vehicle in Critical,
	// otherwise any "Medium" puts it in Warning).
	critical := map[string]bool{}
	warning := map[string]bool{}
	for _, a := range alerts {
		switch a.RiskLevel {
		case "High":
			critical[a.VehicleID] = true
		case "Medium":
			if !critical[a.VehicleID] {
				warning[a.VehicleID] = true
			}
		}
	}
	risk := models.RiskCounts{
		Critical: len(critical),
		Warning:  len(warning),
	}
	risk.Healthy = len(vehicles) - risk.Critical - risk.Warning
	if risk.Healthy < 0 {
		risk.Healthy = 0
	}

	// Compose the disclaimer based on whether history actually informed
	// any alert. If every alert was rule-only, say so plainly. If
	// history contributed, name it.
	historyUsed := false
	for _, a := range alerts {
		if a.SampleCount > 0 {
			historyUsed = true
			break
		}
	}
	disclaimer := "Alerts come from rule-based heuristics (mileage thresholds and vehicle age). Per-vehicle history-driven projections activate as soon as a vehicle has 2+ completed services of the same type."
	if historyUsed {
		disclaimer = "Alerts combine rule-based heuristics (mileage / age thresholds) with per-vehicle history-driven projections from completed maintenance records. Each alert's `source` field declares which signal(s) produced it; `sampleCount` is the number of prior service intervals the projection was averaged over."
	}

	c.JSON(http.StatusOK, models.MaintenanceDueAlertsResponse{
		Alerts:     alerts,
		RiskCounts: risk,
		Disclaimer: disclaimer,
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

// IngestVehicleLocation accepts one GPS reading and persists it to
// vehicle_locations + refreshes the vehicle's denormalized current_*
// columns when the reading is newer than what's stored.
//
// Auth note: this endpoint uses the same JWT auth as the rest of /api/v1.
// In a production deployment with real OBD-II / GPS-tracker devices,
// those devices would NOT carry a user's JWT — they'd authenticate via
// a per-device HMAC-signed token or similar. That's a separate auth
// surface, deferred until devices come online. For now, this endpoint
// is the right shape for browser-driven location updates (mobile
// driver app where the driver IS logged in) and for testing.
//
// Tenancy: the vehicle id in the body must belong to the JWT's tenant
// (verified by an existence check under WithTenant before insert). A
// caller can't write a location for a vehicle in another tenant even
// if they guess a valid vehicle id.
//
// Idempotency / late-arriving readings: the current_* refresh is
// guarded by a conditional UPDATE — current_location_at IS NULL OR <
// recorded_at — so a delayed reading from earlier than the stored
// "current" doesn't overwrite the newer state. The location row
// itself is always inserted; only the denormalized view skips the
// refresh.
func IngestVehicleLocation(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input models.VehicleLocation
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Field-level validation. The DB has NOT NULL constraints on these
	// already, but failing early with a specific message beats a 500.
	if input.VehicleID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "vehicleId required"})
		return
	}
	if input.RecordedAt.IsZero() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "recordedAt required"})
		return
	}
	if input.Latitude < -90 || input.Latitude > 90 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "latitude must be in [-90, 90]"})
		return
	}
	if input.Longitude < -180 || input.Longitude > 180 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "longitude must be in [-180, 180]"})
		return
	}

	// Vehicle existence + tenant ownership check. Failure returns 404
	// deliberately — we don't reveal whether the vehicle exists in
	// another tenant (would be a side-channel).
	var vehicle models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("id = ?", input.VehicleID).
		First(&vehicle).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "vehicle not found"})
		return
	}

	// Stamp tenant from validated JWT; never trust a client-supplied
	// tenantId on the body.
	input.TenantID = tid
	if input.ID == "" {
		input.ID = uuid.New().String()
	}

	if err := database.DB.Create(&input).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Refresh the vehicle's denormalized current_* state ONLY if this
	// reading is newer than the stored value. A buffered/delayed
	// device could legitimately ingest a 5-minute-old reading after a
	// fresher one — that mustn't clobber the latest known position.
	refreshed := database.DB.Model(&models.Vehicle{}).
		Where(
			"id = ? AND tenant_id = ? AND (current_location_at IS NULL OR current_location_at < ?)",
			input.VehicleID, tid, input.RecordedAt,
		).
		Updates(map[string]interface{}{
			"current_lat":         input.Latitude,
			"current_lng":         input.Longitude,
			"current_speed_kph":   input.SpeedKph,
			"current_heading_deg": input.HeadingDeg,
			"current_location_at": input.RecordedAt,
		})

	c.JSON(http.StatusCreated, gin.H{
		"location":         input,
		"currentRefreshed": refreshed.RowsAffected > 0,
	})
}

// GetVehicleLocations returns the GPS trail for one vehicle ordered
// from newest → oldest, optionally bounded by a [from, to] time
// window. Default limit 500; max 5000.
//
//	GET /api/v1/fleet/vehicles/:id/locations
//	      ?from=2026-06-23T00:00:00Z
//	      &to=2026-06-23T23:59:59Z
//	      &limit=1000
//
// Vehicle ownership is verified before the query runs — caller asking
// for another tenant's vehicle gets 404, not an empty array.
func GetVehicleLocations(c *gin.Context) {
	if requireTenant(c) == "" {
		return
	}
	vehicleID := c.Param("id")

	var vehicle models.Vehicle
	if err := database.DB.Scopes(auth.WithTenant(c)).
		Where("id = ?", vehicleID).
		First(&vehicle).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "vehicle not found"})
		return
	}

	q := database.DB.Scopes(auth.WithTenant(c)).Where("vehicle_id = ?", vehicleID)

	if from := strings.TrimSpace(c.Query("from")); from != "" {
		t, err := time.Parse(time.RFC3339, from)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "from must be RFC3339"})
			return
		}
		q = q.Where("recorded_at >= ?", t)
	}
	if to := strings.TrimSpace(c.Query("to")); to != "" {
		t, err := time.Parse(time.RFC3339, to)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to must be RFC3339"})
			return
		}
		q = q.Where("recorded_at <= ?", t)
	}

	limit := 500
	if l := strings.TrimSpace(c.Query("limit")); l != "" {
		n, err := strconv.Atoi(l)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
			return
		}
		if n > 5000 {
			n = 5000 // ceiling to bound the query — operator can paginate
		}
		limit = n
	}

	var locations []models.VehicleLocation
	if err := q.Order("recorded_at DESC").Limit(limit).Find(&locations).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"vehicleId": vehicleID,
		"locations": locations,
		"count":     len(locations),
	})
}

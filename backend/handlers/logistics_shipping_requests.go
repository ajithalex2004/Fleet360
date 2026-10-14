package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"fleet360-backend/auth"
	"fleet360-backend/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	errShippingRequestNotFound        = errors.New("shipping request not found")
	errShippingRequestAlreadyConverted = errors.New("already converted")
	errShippingRequestNotAccepted     = errors.New("not accepted")
)

var validShippingRequestStatuses = map[string]bool{
	"DRAFT":        true,
	"SUBMITTED":    true,
	"UNDER_REVIEW": true,
	"ACCEPTED":     true,
	"REJECTED":     true,
	"CANCELLED":    true,
}

// GetLogisticsShippingRequests lists shipping requests for the tenant.
// Supports status, shipperId, search filters and limit pagination.
func GetLogisticsShippingRequests(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	limit := 200
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	if limit > 500 {
		limit = 500
	}

	status := strings.TrimSpace(c.Query("status"))
	shipperID := strings.TrimSpace(c.Query("shipperId"))
	search := strings.TrimSpace(c.Query("search"))

	requests := make([]models.LogisticsShippingRequest, 0)
	err := auth.Try(c, func(tx *gorm.DB) error {
		q := tx.Table("logistics_shipping_requests r").
			Select("r.*, s.name_en AS shipper_name, s.customer_code AS shipper_code").
			Joins("LEFT JOIN customers s ON s.id = r.shipper_id AND s.tenant_id = r.tenant_id").
			Where("r.tenant_id = ? AND r.deleted_at IS NULL", tid)

		if status != "" {
			q = q.Where("r.status = ?", status)
		}
		if shipperID != "" {
			q = q.Where("r.shipper_id = ?", shipperID)
		}
		if search != "" {
			pat := "%" + search + "%"
			q = q.Where("(r.request_no ILIKE ? OR r.origin_name ILIKE ? OR r.destination_name ILIKE ? OR s.name_en ILIKE ?)", pat, pat, pat, pat)
		}

		return q.Order("r.created_at DESC").Limit(limit).Find(&requests).Error
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list shipping requests"})
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"data": requests})
}

// CreateLogisticsShippingRequest creates a new shipping request.
func CreateLogisticsShippingRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}

	var input struct {
		ShipperID            string         `json:"shipperId"`
		ShipmentType         *string        `json:"shipmentType"`
		OriginName           *string        `json:"originName"`
		OriginAddress        *string        `json:"originAddress"`
		DestinationName      *string        `json:"destinationName"`
		DestinationAddress   *string        `json:"destinationAddress"`
		PickupWindowFrom     *string        `json:"pickupWindowFrom"`
		PickupWindowTo       *string        `json:"pickupWindowTo"`
		DeliveryWindowFrom   *string        `json:"deliveryWindowFrom"`
		DeliveryWindowTo     *string        `json:"deliveryWindowTo"`
		RequestedVehicleType *string        `json:"requestedVehicleType"`
		TotalWeightKg        *float64       `json:"totalWeightKg"`
		TotalVolumeCbm       *float64       `json:"totalVolumeCbm"`
		CargoValueAmount     *float64       `json:"cargoValueAmount"`
		Currency             *string        `json:"currency"`
		GoodsDescription     *string        `json:"goodsDescription"`
		SpecialInstructions  *string        `json:"specialInstructions"`
		ReferenceNo          *string        `json:"referenceNo"`
		Status               *string        `json:"status"`
		Metadata             map[string]any `json:"metadata"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	if strings.TrimSpace(input.ShipperID) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "A shipper is required"})
		return
	}

	var customer struct {
		ID           string  `gorm:"column:id"`
		NameEn       string  `gorm:"column:name_en"`
		CustomerCode *string `gorm:"column:customer_code"`
	}

	err := auth.Try(c, func(tx *gorm.DB) error {
		return tx.Table("customers").
			Where("id = ? AND tenant_id = ? AND deleted_at IS NULL", input.ShipperID, tid).
			First(&customer).Error
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":  "Shipper (customer) not found for this tenant.",
			"issues": []string{"Shipper (customer) not found for this tenant."},
		})
		return
	}

	currency := "AED"
	if input.Currency != nil && strings.TrimSpace(*input.Currency) != "" {
		currency = strings.TrimSpace(*input.Currency)
	}

	status := "SUBMITTED"
	if input.Status != nil && strings.TrimSpace(*input.Status) != "" {
		status = strings.ToUpper(strings.TrimSpace(*input.Status))
	}

	req := models.LogisticsShippingRequest{
		TenantID:             tid,
		ShipperID:            input.ShipperID,
		ShipmentType:         input.ShipmentType,
		OriginName:           input.OriginName,
		OriginAddress:        input.OriginAddress,
		DestinationName:      input.DestinationName,
		DestinationAddress:   input.DestinationAddress,
		PickupWindowFrom:     parseISO(input.PickupWindowFrom),
		PickupWindowTo:       parseISO(input.PickupWindowTo),
		DeliveryWindowFrom:   parseISO(input.DeliveryWindowFrom),
		DeliveryWindowTo:     parseISO(input.DeliveryWindowTo),
		RequestedVehicleType: input.RequestedVehicleType,
		TotalWeightKg:        input.TotalWeightKg,
		TotalVolumeCbm:       input.TotalVolumeCbm,
		CargoValueAmount:     input.CargoValueAmount,
		Currency:             currency,
		GoodsDescription:     input.GoodsDescription,
		SpecialInstructions:  input.SpecialInstructions,
		ReferenceNo:          input.ReferenceNo,
		Status:               status,
		Source:               "OPERATOR",
		Metadata:             input.Metadata,
	}

	if uid := auth.UserID(c); uid != "" {
		req.CreatedBy = &uid
		req.UpdatedBy = &uid
	}

	if err := auth.Try(c, func(tx *gorm.DB) error {
		return tx.Create(&req).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create shipping request"})
		return
	}

	req.ShipperName = &customer.NameEn
	req.ShipperCode = customer.CustomerCode

	c.JSON(http.StatusCreated, gin.H{"data": req})
}

// GetLogisticsShippingRequest loads a single shipping request by ID.
func GetLogisticsShippingRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")

	var req models.LogisticsShippingRequest
	err := auth.Try(c, func(tx *gorm.DB) error {
		return tx.Table("logistics_shipping_requests r").
			Select("r.*, s.name_en AS shipper_name, s.customer_code AS shipper_code").
			Joins("LEFT JOIN customers s ON s.id = r.shipper_id AND s.tenant_id = r.tenant_id").
			Where("r.tenant_id = ? AND r.id = ? AND r.deleted_at IS NULL", tid, id).
			First(&req).Error
	})

	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Shipping request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load shipping request"})
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"data": req})
}

// PatchLogisticsShippingRequest advances the status or review notes.
func PatchLogisticsShippingRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")

	var input struct {
		Status      *string `json:"status"`
		ReviewNotes *string `json:"reviewNotes"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid JSON"})
		return
	}

	if input.Status == nil || strings.TrimSpace(*input.Status) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status is required"})
		return
	}

	targetStatus := strings.ToUpper(strings.TrimSpace(*input.Status))
	if targetStatus == "CONVERTED" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":  "Use the convert action to turn a request into a job order.",
			"issues": []string{"Use the convert action to turn a request into a job order."},
		})
		return
	}

	if !validShippingRequestStatuses[targetStatus] {
		c.JSON(http.StatusUnprocessableEntity, gin.H{
			"error":  fmt.Sprintf(`Unknown shipping-request status "%s".`, *input.Status),
			"issues": []string{fmt.Sprintf(`Unknown shipping-request status "%s".`, *input.Status)},
		})
		return
	}

	var req models.LogisticsShippingRequest
	err := auth.Try(c, func(tx *gorm.DB) error {
		var existing models.LogisticsShippingRequest
		if err := tx.Where("tenant_id = ? AND id = ? AND deleted_at IS NULL", tid, id).First(&existing).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errShippingRequestNotFound
			}
			return err
		}

		if existing.Status == "CONVERTED" {
			return errShippingRequestAlreadyConverted
		}

		updates := map[string]any{
			"status":     targetStatus,
			"updated_at": time.Now().UTC(),
		}
		if input.ReviewNotes != nil {
			updates["review_notes"] = *input.ReviewNotes
		}
		if uid := auth.UserID(c); uid != "" {
			updates["updated_by"] = uid
		}

		if err := tx.Model(&models.LogisticsShippingRequest{}).
			Where("tenant_id = ? AND id = ?", tid, id).
			Updates(updates).Error; err != nil {
			return err
		}

		return tx.Table("logistics_shipping_requests r").
			Select("r.*, s.name_en AS shipper_name, s.customer_code AS shipper_code").
			Joins("LEFT JOIN customers s ON s.id = r.shipper_id AND s.tenant_id = r.tenant_id").
			Where("r.tenant_id = ? AND r.id = ?", tid, id).
			First(&req).Error
	})

	if err != nil {
		if errors.Is(err, errShippingRequestNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Shipping request not found for this tenant"})
			return
		}
		if errors.Is(err, errShippingRequestAlreadyConverted) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":  "This request has already been converted into a job order.",
				"issues": []string{"This request has already been converted into a job order."},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update shipping request"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": req})
}

// ConvertLogisticsShippingRequest converts an ACCEPTED request into a shipment order.
func ConvertLogisticsShippingRequest(c *gin.Context) {
	tid := requireTenant(c)
	if tid == "" {
		return
	}
	id := c.Param("id")

	var updatedReq models.LogisticsShippingRequest
	var shipment models.LogisticsShipmentOrder

	err := auth.Try(c, func(tx *gorm.DB) error {
		// 1. Lock the shipping request row FOR UPDATE to prevent race conditions
		var req models.LogisticsShippingRequest
		if err := tx.Raw(
			`SELECT * FROM logistics_shipping_requests WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL FOR UPDATE`,
			tid, id,
		).Scan(&req).Error; err != nil || req.ID == "" {
			return errShippingRequestNotFound
		}

		if req.Status == "CONVERTED" || (req.ShipmentOrderID != nil && *req.ShipmentOrderID != "") {
			return errShippingRequestAlreadyConverted
		}

		if req.Status != "ACCEPTED" {
			return fmt.Errorf("%w: Only ACCEPTED shipping requests can be converted into a job order. Current status: \"%s\".", errShippingRequestNotAccepted, req.Status)
		}

		// 2. Load shipper details from customers
		var cust struct {
			NameEn       string  `gorm:"column:name_en"`
			Email        *string `gorm:"column:email"`
			MobileNumber *string `gorm:"column:mobile_number"`
		}
		_ = tx.Table("customers").Where("id = ? AND tenant_id = ?", req.ShipperID, tid).First(&cust)

		// 3. Generate shipment order number
		shipmentNo, err := models.NextShipmentOrderNo(tx, tid)
		if err != nil {
			return err
		}

		sourceChannel := "SHIPPING_REQUEST"
		uid := auth.UserID(c)

		var noteParts []string
		if req.GoodsDescription != nil && *req.GoodsDescription != "" {
			noteParts = append(noteParts, *req.GoodsDescription)
		}
		if req.SpecialInstructions != nil && *req.SpecialInstructions != "" {
			noteParts = append(noteParts, *req.SpecialInstructions)
		}
		var notes *string
		if len(noteParts) > 0 {
			n := strings.Join(noteParts, " — ")
			notes = &n
		}

		metadata := map[string]any{
			"shippingRequestId":  req.ID,
			"shippingRequestNo":  req.RequestNo,
			"shipperReferenceNo": req.ReferenceNo,
			"goodsDescription":   req.GoodsDescription,
		}

		shipment = models.LogisticsShipmentOrder{
			TenantID:             tid,
			ShipmentNo:           shipmentNo,
			CargoOwnerCustomerID: &req.ShipperID,
			CargoOwnerName:       &cust.NameEn,
			CargoOwnerEmail:      cust.Email,
			CargoOwnerPhone:      cust.MobileNumber,
			ShipmentType:         req.ShipmentType,
			BookingMode:          "SPOT",
			MarketplaceStatus:    "PRIVATE",
			Status:               "DRAFT",
			Priority:             "NORMAL",
			OriginName:           req.OriginName,
			OriginAddress:        req.OriginAddress,
			DestinationName:      req.DestinationName,
			DestinationAddress:   req.DestinationAddress,
			PickupWindowFrom:     req.PickupWindowFrom,
			PickupWindowTo:       req.PickupWindowTo,
			DeliveryWindowFrom:   req.DeliveryWindowFrom,
			DeliveryWindowTo:     req.DeliveryWindowTo,
			RequestedVehicleType: req.RequestedVehicleType,
			TotalWeightKg:        req.TotalWeightKg,
			TotalVolumeCbm:       req.TotalVolumeCbm,
			CargoValueAmount:     req.CargoValueAmount,
			Currency:             req.Currency,
			SourceChannel:        &sourceChannel,
			Notes:                notes,
			Metadata:             metadata,
		}
		if uid != "" {
			shipment.CreatedBy = &uid
			shipment.UpdatedBy = &uid
		}

		if err := tx.Create(&shipment).Error; err != nil {
			return err
		}

		// 4. Create default PICKUP and DELIVERY stops
		pickupStop := models.LogisticsShipmentStop{
			ID:               uuid.New().String(),
			CreatedAt:        time.Now().UTC(),
			UpdatedAt:        time.Now().UTC(),
			TenantID:         tid,
			ShipmentOrderID:  shipment.ID,
			SequenceNo:       1,
			StopType:         "PICKUP",
			LocationName:     req.OriginName,
			Address:          req.OriginAddress,
			PlannedArrivalAt: req.PickupWindowFrom,
			PlannedDepartAt:  req.PickupWindowTo,
		}
		if err := tx.Create(&pickupStop).Error; err != nil {
			return err
		}

		deliveryStop := models.LogisticsShipmentStop{
			ID:               uuid.New().String(),
			CreatedAt:        time.Now().UTC(),
			UpdatedAt:        time.Now().UTC(),
			TenantID:         tid,
			ShipmentOrderID:  shipment.ID,
			SequenceNo:       2,
			StopType:         "DELIVERY",
			LocationName:     req.DestinationName,
			Address:          req.DestinationAddress,
			PlannedArrivalAt: req.DeliveryWindowFrom,
			PlannedDepartAt:  req.DeliveryWindowTo,
		}
		if err := tx.Create(&deliveryStop).Error; err != nil {
			return err
		}

		// 5. Create cargo line if goods description exists
		if req.GoodsDescription != nil && *req.GoodsDescription != "" {
			cargoLine := models.LogisticsCargoLine{
				ID:              uuid.New().String(),
				CreatedAt:       time.Now().UTC(),
				TenantID:        tid,
				ShipmentOrderID: shipment.ID,
				Description:     *req.GoodsDescription,
				WeightKg:        req.TotalWeightKg,
				VolumeCbm:       req.TotalVolumeCbm,
			}
			if err := tx.Create(&cargoLine).Error; err != nil {
				return err
			}
		}

		// 6. Record tracking event
		trackingNotes := fmt.Sprintf("Job order created from shipping request %s", req.RequestNo)
		trackingEvent := models.LogisticsTrackingEvent{
			ID:              uuid.New().String(),
			CreatedAt:       time.Now().UTC(),
			TenantID:        tid,
			ShipmentOrderID: shipment.ID,
			EventType:       "SHIPPING_REQUEST_CONVERTED",
			Status:          &shipment.Status,
			Source:          "FREIGHT_MARKETPLACE",
			Notes:           &trackingNotes,
			OccurredAt:      time.Now().UTC(),
			Metadata: map[string]any{
				"shippingRequestId": req.ID,
				"requestNo":         req.RequestNo,
			},
		}
		if err := tx.Create(&trackingEvent).Error; err != nil {
			return err
		}

		// 7. Atomic update of shipping request status to CONVERTED
		res := tx.Model(&models.LogisticsShippingRequest{}).
			Where("tenant_id = ? AND id = ? AND status = 'ACCEPTED'", tid, id).
			Updates(map[string]any{
				"status":            "CONVERTED",
				"shipment_order_id": shipment.ID,
				"updated_at":        time.Now().UTC(),
				"updated_by":        uid,
			})
		if res.Error != nil || res.RowsAffected == 0 {
			return errShippingRequestAlreadyConverted
		}

		return tx.Table("logistics_shipping_requests r").
			Select("r.*, s.name_en AS shipper_name, s.customer_code AS shipper_code").
			Joins("LEFT JOIN customers s ON s.id = r.shipper_id AND s.tenant_id = r.tenant_id").
			Where("r.tenant_id = ? AND r.id = ?", tid, id).
			First(&updatedReq).Error
	})

	if err != nil {
		if errors.Is(err, errShippingRequestNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Shipping request not found for this tenant"})
			return
		}
		if errors.Is(err, errShippingRequestAlreadyConverted) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":  "This request has already been converted into a job order.",
				"issues": []string{"This request has already been converted into a job order."},
			})
			return
		}
		if errors.Is(err, errShippingRequestNotAccepted) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"error":  err.Error(),
				"issues": []string{err.Error()},
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to convert shipping request"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"data": gin.H{
			"shipmentOrderId": shipment.ID,
			"shipmentNo":      shipment.ShipmentNo,
			"request":         updatedReq,
			"shipment": gin.H{
				"id":         shipment.ID,
				"shipmentNo": shipment.ShipmentNo,
				"status":     shipment.Status,
			},
		},
	})
}

func parseISO(s *string) *time.Time {
	if s == nil || strings.TrimSpace(*s) == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(*s))
	if err != nil {
		t, err = time.Parse("2006-01-02", strings.TrimSpace(*s))
		if err != nil {
			return nil
		}
	}
	utc := t.UTC()
	return &utc
}

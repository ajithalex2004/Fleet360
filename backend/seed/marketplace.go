package seed

import (
	"os"
	"time"

	"fleet360-backend/database"
	"fleet360-backend/logging"
	"fleet360-backend/models"

	"go.uber.org/zap"
	"gorm.io/gorm/clause"
)

func SeedMarketplaceDemo() {
	log := logging.L()
	tenantID := marketplaceSeedTenantID()
	if tenantID == "" {
		tenantID = "demo-tenant-logistics"
		database.DB.Exec(
			`INSERT INTO tenants (id, name, code, plan, is_active, created_at, updated_at)
			 VALUES (?, 'Demo Logistics Tenant', 'DEMO-LOGISTICS', 'ENTERPRISE', true, NOW(), NOW())
			 ON CONFLICT (id) DO NOTHING`,
			tenantID,
		)
		log.Warn("no active tenant found; created a demo tenant for marketplace seed", zap.String("tenant_id", tenantID))
	}

	now := time.Now().UTC()
	deadline := now.Add(6 * time.Hour)
	validity := now.Add(24 * time.Hour)
	pickup := now.Add(18 * time.Hour)
	delivery := now.Add(42 * time.Hour)
	five := 5.0
	seven := 7.0
	nine := 9.0
	carrierType := "TRANSPORT_COMPANY"

	carriers := []models.LogisticsCarrier{
		{
			Model:            models.Model{ID: "demo-carrier-gulfline"},
			TenantID:         tenantID,
			CarrierCode:      strp("GLF"),
			CarrierType:      carrierType,
			Name:             "GulfLine Transport LLC",
			TradeLicense:     strp("TL-GLF-2026"),
			ContactName:      strp("Nader Al Mansoori"),
			ContactEmail:     strp("ops@gulfline.example"),
			ContactPhone:     strp("+971501110001"),
			Status:           "ACTIVE",
			OnboardingStatus: "APPROVED",
			ComplianceStatus: "COMPLIANT",
			CommissionModel:  strp("PERCENTAGE"),
			CommissionRate:   &five,
			ServiceRegions:   map[string]any{"countries": []string{"AE"}, "cities": []string{"Dubai", "Abu Dhabi"}},
			CapacityProfile:  map[string]any{"vehicleTypes": []string{"Box Truck", "Curtain Side"}, "maxWeightKg": 18000},
			MarginRuleJSON:   map[string]any{"minMarginPct": 8},
			Metadata:         map[string]any{"demoSeed": true},
		},
		{
			Model:            models.Model{ID: "demo-carrier-desertfalcon"},
			TenantID:         tenantID,
			CarrierCode:      strp("DFL"),
			CarrierType:      carrierType,
			Name:             "Desert Falcon Freight",
			TradeLicense:     strp("TL-DFL-2026"),
			ContactName:      strp("Sara Khan"),
			ContactEmail:     strp("dispatch@desertfalcon.example"),
			ContactPhone:     strp("+971501110002"),
			Status:           "ACTIVE",
			OnboardingStatus: "APPROVED",
			ComplianceStatus: "COMPLIANT",
			CommissionModel:  strp("PERCENTAGE"),
			CommissionRate:   &seven,
			ServiceRegions:   map[string]any{"countries": []string{"AE"}, "cities": []string{"Dubai", "Sharjah", "Abu Dhabi"}},
			CapacityProfile:  map[string]any{"vehicleTypes": []string{"Box Truck", "Reefer"}, "maxWeightKg": 12000},
			MarginRuleJSON:   map[string]any{"minMarginPct": 10},
			Metadata:         map[string]any{"demoSeed": true},
		},
		{
			Model:            models.Model{ID: "demo-carrier-palmexpress"},
			TenantID:         tenantID,
			CarrierCode:      strp("PEX"),
			CarrierType:      carrierType,
			Name:             "Palm Express Cargo",
			TradeLicense:     strp("TL-PEX-2026"),
			ContactName:      strp("Imran Qureshi"),
			ContactEmail:     strp("rfq@palmexpress.example"),
			ContactPhone:     strp("+971501110003"),
			Status:           "ACTIVE",
			OnboardingStatus: "APPROVED",
			ComplianceStatus: "COMPLIANT",
			CommissionModel:  strp("PERCENTAGE"),
			CommissionRate:   &nine,
			ServiceRegions:   map[string]any{"countries": []string{"AE"}, "cities": []string{"Dubai", "Al Ain"}},
			CapacityProfile:  map[string]any{"vehicleTypes": []string{"Curtain Side"}, "maxWeightKg": 24000},
			MarginRuleJSON:   map[string]any{"minMarginPct": 12},
			Metadata:         map[string]any{"demoSeed": true},
		},
	}
	for _, carrier := range carriers {
		database.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&carrier)
	}
	seedCarrierAwardDocuments(tenantID, carriers)

	customerRate := 3650.0
	weight := 9200.0
	volume := 42.0
	shipments := []models.LogisticsShipmentOrder{
		{
			Model:                models.Model{ID: "demo-shipment-rfq-open"},
			TenantID:             tenantID,
			ShipmentNo:           "SHP-DEMO-RFQ-001",
			CargoOwnerName:       strp("Al Barsha Retail Distribution"),
			CargoOwnerEmail:      strp("logistics@albarsha-retail.example"),
			CargoOwnerPhone:      strp("+97144220001"),
			ShipmentType:         strp("FTL"),
			BookingMode:          "SPOT",
			MarketplaceStatus:    "OPEN",
			Status:               "APPROVED",
			Priority:             "HIGH",
			OriginName:           strp("Jebel Ali Free Zone"),
			OriginAddress:        strp("JAFZA South, Dubai"),
			DestinationName:      strp("Mussafah Industrial Area"),
			DestinationAddress:   strp("M-40, Abu Dhabi"),
			PickupWindowFrom:     &pickup,
			DeliveryWindowTo:     &delivery,
			RequestedVehicleType: strp("Curtain Side"),
			TotalWeightKg:        &weight,
			TotalVolumeCbm:       &volume,
			Currency:             "AED",
			CustomerRateAmount:   &customerRate,
			Notes:                strp("Demo marketplace RFQ load with three carrier bids."),
			Metadata:             map[string]any{"demoSeed": true},
		},
		{
			Model:                models.Model{ID: "demo-shipment-postable"},
			TenantID:             tenantID,
			ShipmentNo:           "SHP-DEMO-POST-002",
			CargoOwnerName:       strp("Dubai Food Services"),
			CargoOwnerEmail:      strp("ops@dubai-food.example"),
			CargoOwnerPhone:      strp("+97144220002"),
			ShipmentType:         strp("FTL"),
			BookingMode:          "SPOT",
			MarketplaceStatus:    "PRIVATE",
			Status:               "APPROVED",
			Priority:             "NORMAL",
			OriginName:           strp("Dubai Investment Park"),
			DestinationName:      strp("Sharjah Industrial Area 10"),
			PickupWindowFrom:     timep(now.Add(30 * time.Hour)),
			DeliveryWindowTo:     timep(now.Add(54 * time.Hour)),
			RequestedVehicleType: strp("Reefer"),
			TotalWeightKg:        floatp(6400),
			TotalVolumeCbm:       floatp(33),
			Currency:             "AED",
			CustomerRateAmount:   floatp(2450),
			Notes:                strp("Demo postable shipment for creating a fresh RFQ from the UI."),
			Metadata:             map[string]any{"demoSeed": true},
		},
	}
	for _, shipment := range shipments {
		database.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&shipment)
	}

	rfq := models.LogisticsFreightRFQ{
		ID:               "demo-rfq-open-001",
		TenantID:         tenantID,
		ShipmentOrderID:  "demo-shipment-rfq-open",
		RFQNo:            "RFQ-DEMO-001",
		Status:           "OPEN",
		InviteScope:      "SELECTED_CARRIERS",
		BidDeadlineAt:    &deadline,
		NegotiationRound: 1,
		Metadata: map[string]any{
			"demoSeed":          true,
			"invitedCarrierIds": []string{"demo-carrier-gulfline", "demo-carrier-desertfalcon", "demo-carrier-palmexpress"},
		},
	}
	database.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&rfq)

	bids := []models.LogisticsCarrierBid{
		{
			ID:               "demo-bid-gulfline",
			TenantID:         tenantID,
			ShipmentOrderID:  "demo-shipment-rfq-open",
			RFQID:            strp("demo-rfq-open-001"),
			CarrierID:        "demo-carrier-gulfline",
			BidNo:            strp("BID-DEMO-001"),
			Amount:           2850,
			Currency:         "AED",
			TransitTimeHours: intp(18),
			ValidityUntil:    &validity,
			Status:           "SUBMITTED",
			ChargeBreakdown:  map[string]any{"linehaul": 2500, "fuel": 250, "loading": 100},
			Notes:            strp("Can collect within 2 hours of pickup window."),
		},
		{
			ID:               "demo-bid-desertfalcon",
			TenantID:         tenantID,
			ShipmentOrderID:  "demo-shipment-rfq-open",
			RFQID:            strp("demo-rfq-open-001"),
			CarrierID:        "demo-carrier-desertfalcon",
			BidNo:            strp("BID-DEMO-002"),
			Amount:           2725,
			Currency:         "AED",
			TransitTimeHours: intp(20),
			ValidityUntil:    &validity,
			Status:           "SUBMITTED",
			ChargeBreakdown:  map[string]any{"linehaul": 2400, "fuel": 225, "loading": 100},
			Notes:            strp("Best price; delivery next morning."),
		},
		{
			ID:               "demo-bid-palmexpress",
			TenantID:         tenantID,
			ShipmentOrderID:  "demo-shipment-rfq-open",
			RFQID:            strp("demo-rfq-open-001"),
			CarrierID:        "demo-carrier-palmexpress",
			BidNo:            strp("BID-DEMO-003"),
			Amount:           3100,
			Currency:         "AED",
			TransitTimeHours: intp(16),
			ValidityUntil:    &validity,
			Status:           "SUBMITTED",
			ChargeBreakdown:  map[string]any{"linehaul": 2800, "fuel": 200, "express": 100},
			Notes:            strp("Fastest transit option."),
		},
	}
	for _, bid := range bids {
		database.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&bid)
	}

	scorecards := []models.LogisticsCarrierScorecard{
		scorecard(tenantID, "demo-score-gulfline", "demo-carrier-gulfline", 96, 92, 1, 4.7, 48, true),
		scorecard(tenantID, "demo-score-desertfalcon", "demo-carrier-desertfalcon", 91, 95, 2, 4.5, 37, true),
		scorecard(tenantID, "demo-score-palmexpress", "demo-carrier-palmexpress", 88, 86, 3, 4.3, 29, false),
	}
	for _, card := range scorecards {
		database.DB.Clauses(clause.OnConflict{UpdateAll: true}).Create(&card)
	}

	log.Info("marketplace demo seed complete", zap.String("tenant_id", tenantID), zap.Int("carriers", len(carriers)), zap.Int("shipments", len(shipments)), zap.Int("bids", len(bids)))
}

func marketplaceSeedTenantID() string {
	if id := os.Getenv("MARKETPLACE_SEED_TENANT_ID"); id != "" {
		return id
	}
	if id := os.Getenv("LOGISTICS_SEED_TENANT_ID"); id != "" {
		return id
	}
	var row struct{ ID string }
	database.DB.Raw("SELECT id FROM tenants WHERE COALESCE(is_active, true) = true ORDER BY created_at ASC LIMIT 1").Scan(&row)
	return row.ID
}

func scorecard(tenantID, id, carrierID string, onTime, acceptance, cancel, rating float64, completed int, preferred bool) models.LogisticsCarrierScorecard {
	now := time.Now().UTC()
	start := now.AddDate(0, -1, 0)
	return models.LogisticsCarrierScorecard{
		ID:                 id,
		TenantID:           tenantID,
		CarrierID:          carrierID,
		PeriodStart:        &start,
		PeriodEnd:          &now,
		OnTimeRate:         &onTime,
		AcceptanceRate:     &acceptance,
		CancellationRate:   &cancel,
		ClaimRate:          floatp(0),
		ComplianceScore:    floatp(98),
		AverageRating:      &rating,
		ShipmentsCompleted: completed,
		Preferred:          preferred,
		Blacklisted:        false,
		Status:             "ACTIVE",
		Metadata:           map[string]any{"demoSeed": true},
	}
}

func seedCarrierAwardDocuments(tenantID string, carriers []models.LogisticsCarrier) {
	issue := time.Now().UTC().AddDate(0, -1, 0)
	expiry := time.Now().UTC().AddDate(1, 0, 0)
	for _, carrier := range carriers {
		for _, docType := range []string{"TRADE_LICENSE", "INSURANCE"} {
			docID := "demo-doc-" + carrier.ID + "-" + docType
			name := docType
			if docType == "TRADE_LICENSE" {
				name = "Trade license"
			}
			if docType == "INSURANCE" {
				name = "Carrier insurance"
			}
			database.DB.Exec(
				`INSERT INTO logistics_carrier_documents (
				    id, tenant_id, carrier_id, document_type, document_name, document_url,
				    status, issue_date, expiry_date, verified_by, verified_at, metadata,
				    created_at, updated_at
				  )
				  VALUES (?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?, 'seed-marketplace', NOW(), ?::jsonb, NOW(), NOW())
				  ON CONFLICT (id) DO UPDATE SET
				    document_name = EXCLUDED.document_name,
				    document_url = EXCLUDED.document_url,
				    status = EXCLUDED.status,
				    issue_date = EXCLUDED.issue_date,
				    expiry_date = EXCLUDED.expiry_date,
				    verified_by = EXCLUDED.verified_by,
				    verified_at = EXCLUDED.verified_at,
				    metadata = EXCLUDED.metadata,
				    updated_at = NOW()`,
				docID,
				tenantID,
				carrier.ID,
				docType,
				name,
				"https://example.invalid/demo/"+docID+".pdf",
				issue,
				expiry,
				`{"demoSeed":true}`,
			)
		}
	}
}

func strp(s string) *string        { return &s }
func intp(i int) *int              { return &i }
func floatp(f float64) *float64    { return &f }
func timep(t time.Time) *time.Time { return &t }

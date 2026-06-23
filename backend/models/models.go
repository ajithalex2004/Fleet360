package models

import (
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// Enums
type MaintenanceStatus string
type AlertSeverity string
type AlertType string
type ActionStatus string
type MaintenanceType string
type MaintenancePriority string

const (
	StatusRequested                 MaintenanceStatus = "Requested"
	StatusAccepted                  MaintenanceStatus = "Accepted"
	StatusRejected                  MaintenanceStatus = "Rejected"
	StatusUnderEstimation           MaintenanceStatus = "Under Estimation"
	StatusPendingEstimationApproval MaintenanceStatus = "Pending Estimation Approval"
	StatusUnderMaintenance          MaintenanceStatus = "Under Maintenance"
	StatusMaintenanceCompleted      MaintenanceStatus = "Maintenance Completed"
	StatusCompleted                 MaintenanceStatus = "Completed"
)

type QuotationStatus string

const (
	QuotationStatusPending  QuotationStatus = "PENDING"
	QuotationStatusApproved QuotationStatus = "APPROVED"
	QuotationStatusRejected QuotationStatus = "REJECTED"
	QuotationStatusExpired  QuotationStatus = "EXPIRED"
)

// Base Model
type Model struct {
	ID        string         `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time      `json:"createdAt"`
	UpdatedAt time.Time      `json:"updatedAt"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deletedAt"`
}

// BeforeCreate hook to generate UUID if ID is empty
func (m *Model) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return
}

// Vehicle
// Vehicle is the Go-side mirror of Prisma's `vehicles` table. Until this
// expansion the struct carried only the DMV-registration slice (~9
// fields); the Prisma schema has ~40 columns and the Go backend was blind
// to most of them. That blindness blocked downstream work — predictive
// maintenance couldn't differentiate a school bus from a rental car,
// fuel-cost calcs couldn't read fuelType, hierarchy/branch filters
// couldn't run server-side. This struct now mirrors prisma/schema.prisma
// (`model Vehicle { ... }`) field-for-field so any column the database
// stores is readable + writable from Go handlers and GORM scopes.
//
// No schema migration is needed: every field already exists on the
// `vehicles` table via the Prisma schema; this commit only teaches GORM
// how to map them. Existing rows are read transparently because GORM
// ignores DB columns the struct doesn't name AND treats missing-column
// values as zero; both directions are forward-compatible.
//
// Field-type conventions:
//   - Nullable strings → plain `string` (zero value = "" = NULL on read)
//   - Nullable times that may be unset → `*time.Time` so we can
//     distinguish "never set" from "epoch zero" (matches the existing
//     CompletionDate / ExpectedEndDate pattern on MaintenanceRequest)
//   - Decimals → float64 (matches the existing cost-field pattern across
//     the codebase; precision loss is acceptable at AED granularity)
//
// The two pre-existing time.Time fields (RegistrationExpiry,
// InsuranceExpiry) are kept as non-pointer for backward compatibility
// with any handler / serializer that consumes them. New nullable times
// use *time.Time to honour the Prisma schema's nullability.
type Vehicle struct {
	Model
	TenantID string `gorm:"not null;index;column:tenant_id" json:"tenantId"`

	// -- Identity (Fleet Hub core fields) -------------------------------------
	Make         string `json:"make"`
	VehicleModel string `gorm:"column:model" json:"model"`
	Type         string `json:"type"`
	Year         int    `json:"year"`
	LicensePlate string `gorm:"uniqueIndex;column:license_plate" json:"licensePlate"`
	VIN          string `gorm:"uniqueIndex;column:vin" json:"vin"`
	Color        string `gorm:"column:color" json:"color"`
	FuelType     string `gorm:"column:fuel_type" json:"fuelType"`

	// -- Classification (three orthogonal axes) -------------------------------
	// Usage = what the vehicle is FOR (RENTAL | STAFF | SCHOOL_BUS |
	//   LOGISTICS | AMBULANCE | POOL | EXECUTIVE). Drives the maintenance
	//   schedule defaults and the fleet KPI rollups.
	// Group = body type (ECONOMY | LUXURY | BUS | VAN | PICKUP | SUV).
	// Class = size tier (COMPACT | MID_SIZE | FULL_SIZE).
	VehicleUsage    string `gorm:"column:vehicle_usage" json:"vehicleUsage"`
	VehicleGroup    string `gorm:"column:vehicle_group" json:"vehicleGroup"`
	VehicleClass    string `gorm:"column:vehicle_class" json:"vehicleClass"`
	SeatingCapacity int    `gorm:"column:seating_capacity" json:"seatingCapacity"`

	// -- Operational ----------------------------------------------------------
	// CurrentMileage is the canonical odometer; OdometerReading is a
	// separately-captured reading retained from a legacy column. Phase B
	// (live location) will introduce a separate time-series table for
	// per-reading history.
	Status          string  `json:"status"`
	CurrentMileage  int     `gorm:"column:current_mileage" json:"currentMileage"`
	OdometerReading int     `gorm:"column:odometer_reading" json:"odometerReading"`
	FuelLevel       float64 `gorm:"column:fuel_level" json:"fuelLevel"`

	// -- Fleet extended fields ------------------------------------------------
	// Hierarchy / branch fields are denormalized flat strings today
	// (Phase C will normalize into a vehicle_groups tree); they still
	// work as filter keys.
	// DeviceID is the OBD-II tracker's physical id — kept as a column
	// rather than a separate Devices table because devices rarely move
	// between vehicles in this fleet topology.
	VehicleCode     string     `gorm:"column:vehicle_code" json:"vehicleCode"`
	VehicleTypeID   string     `gorm:"column:vehicle_type_id" json:"vehicleTypeId"`
	LifecycleStage  string     `gorm:"column:lifecycle_stage" json:"lifecycleStage"`
	AcquisitionType string     `gorm:"column:acquisition_type" json:"acquisitionType"`
	PurchaseDate    *time.Time `gorm:"column:purchase_date" json:"purchaseDate"`
	PurchasePrice   float64    `gorm:"column:purchase_price" json:"purchasePrice"`
	Emirate         string     `gorm:"column:emirate" json:"emirate"`
	PlateNumber     string     `gorm:"column:plate_number" json:"plateNumber"`
	PlateCode       string     `gorm:"column:plate_code" json:"plateCode"`
	PlateCategory   string     `gorm:"column:plate_category" json:"plateCategory"`
	RegistrationNo  string     `gorm:"column:registration_no" json:"registrationNo"`
	ChassisNo       string     `gorm:"column:chassis_no" json:"chassisNo"`
	HierarchyID     string     `gorm:"column:hierarchy_id" json:"hierarchyId"`
	HierarchyName   string     `gorm:"column:hierarchy_name" json:"hierarchyName"`
	BranchID        string     `gorm:"column:branch_id" json:"branchId"`
	BranchName      string     `gorm:"column:branch_name" json:"branchName"`
	DeviceID        string     `gorm:"column:device_id" json:"deviceId"`
	SimCardNo       string     `gorm:"column:sim_card_no" json:"simCardNo"`
	Category        string     `gorm:"column:category" json:"category"`
	Notes           string     `gorm:"column:notes" json:"notes"`

	// -- Compliance -----------------------------------------------------------
	// RegistrationExpiry / InsuranceExpiry pre-existed as non-pointer
	// time.Time; preserved as-is to avoid touching consumers. New
	// nullable date field MulkiyaExpiry uses *time.Time so a NULL DB
	// value serialises as JSON null rather than the epoch zero.
	RegistrationExpiry time.Time  `gorm:"column:registration_expiry" json:"registrationExpiry"`
	InsuranceExpiry    time.Time  `gorm:"column:insurance_expiry" json:"insuranceExpiry"`
	MulkiyaExpiry      *time.Time `gorm:"column:mulkiya_expiry" json:"mulkiyaExpiry"`

	// -- Ownership / assignment -----------------------------------------------
	AssignedDriverID string `gorm:"column:assigned_driver_id" json:"assignedDriverId"`
	GarageID         string `gorm:"column:garage_id" json:"garageId"`
}

// Driver
type Driver struct {
	Model
	TenantID          string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	Name              string    `json:"name"`
	LicenseNumber     string    `gorm:"uniqueIndex" json:"licenseNumber"`
	LicenseExpiry     time.Time `json:"licenseExpiry"`
	AssignedVehicleID *string   `json:"assignedVehicleId"`
	ContactNumber     string    `json:"contactNumber"`
	Email             string    `json:"email"`
}

// Garage
type Garage struct {
	Model
	TenantID      string         `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	Name          string         `json:"name"`
	Location      string         `json:"location"`
	ContactPerson string         `json:"contactPerson"`
	Designation   string         `json:"designation"`
	Email         string         `json:"email"`
	ContactNumber string         `json:"contactNumber"`
	Specialties   pq.StringArray `gorm:"type:text[]" json:"specialties"`
	IsInternal    bool           `json:"isInternal"`
}

// Work Order Types
type WorkLogEntry struct {
	ID             string    `json:"id"`
	Timestamp      time.Time `json:"timestamp"`
	TechnicianID   string    `json:"technicianId"`
	TechnicianName string    `json:"technicianName"`
	Activity       string    `json:"activity"`
	HoursSpent     float64   `json:"hoursSpent"`
	Notes          string    `json:"notes"`
}

type PartUsage struct {
	ID           string  `json:"id"`
	PartID       string  `json:"partId"`
	PartName     string  `json:"partName"`
	PartNumber   string  `json:"partNumber"`
	QuantityUsed int     `json:"quantityUsed"`
	UnitCost     float64 `json:"unitCost"`
	TotalCost    float64 `json:"totalCost"`
	Source       string  `json:"source"`
}

type ChecklistItem struct {
	ID          string    `json:"id"`
	Task        string    `json:"task"`
	Completed   bool      `json:"completed"`
	CompletedBy string    `json:"completedBy"`
	CompletedAt time.Time `json:"completedAt"`
}

type Technician struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Specialization []string `json:"specialization"`
	GarageID       string   `json:"garageId"`
}

type ActualCosts struct {
	Parts float64 `json:"parts"`
	Labor float64 `json:"labor"`
	Other float64 `json:"other"`
	Total float64 `json:"total"`
}

// MaintenanceRequest
type MaintenanceRequest struct {
	Model
	TenantID            string            `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	VehicleID           string            `json:"vehicleId"`
	Vehicle             Vehicle           `gorm:"foreignKey:VehicleID" json:"vehicle"`
	DriverID            string            `json:"driverId"`
	Driver              Driver            `gorm:"foreignKey:DriverID" json:"driver"`
	RequestDate         time.Time         `json:"requestDate"`
	Description         string            `json:"description"`
	Status              MaintenanceStatus `json:"status"`
	ExpectedEndDate     *time.Time        `json:"expectedEndDate"`
	GarageID            *string           `json:"garageId"`
	Garage              *Garage           `gorm:"foreignKey:GarageID" json:"garage"`
	EstimatedCost       float64           `json:"estimatedCost"`
	ActualCost          float64           `json:"actualCost"`
	ActualPartsCost     float64           `json:"actualPartsCost"`
	ActualLaborCost     float64           `json:"actualLaborCost"`
	ActualOtherCost     float64           `json:"actualOtherCost"`
	CompletionDate      *time.Time        `json:"completionDate"`
	Comments            []Comment         `gorm:"foreignKey:MaintenanceRequestID" json:"comments"`
	History             []History         `gorm:"foreignKey:MaintenanceRequestID" json:"history"`
	MaintenanceType     string            `json:"maintenanceType"`
	Priority            string            `json:"priority"`
	WorkOrderNo         string            `json:"workOrderNo"`
	Odometer            int               `json:"odometer"`
	Attachments         []Attachment      `gorm:"foreignKey:MaintenanceRequestID" json:"attachments"`
	Quotations          []Quotation       `gorm:"foreignKey:MaintenanceRequestID" json:"quotations"`
	CandidateGarageIDs  []string          `gorm:"serializer:json" json:"candidateGarageIds"`
	MaintenanceJobs     pq.StringArray    `gorm:"type:text[]" json:"maintenanceJobs"`
	EstimateApproval    EstimateApproval  `gorm:"serializer:json" json:"estimateApproval"`
	WorkLog             []WorkLogEntry    `gorm:"serializer:json" json:"workLog"`
	PartsUsed           []PartUsage       `gorm:"serializer:json" json:"partsUsed"`
	ChecklistItems      []ChecklistItem   `gorm:"serializer:json" json:"checklistItems"`
	AssignedTechnicians []Technician      `gorm:"serializer:json" json:"assignedTechnicians"`
	ActualCostsData     ActualCosts       `gorm:"serializer:json" json:"actualCostsDetails"`
}

// BeforeCreate hook for MaintenanceRequest
func (mr *MaintenanceRequest) BeforeCreate(tx *gorm.DB) (err error) {
	// If ID is already set, don't generate one
	if mr.ID != "" {
		return
	}

	// Get current year short format (e.g., 25)
	currentYear := time.Now().Format("06")
	prefix := "MR" + currentYear

	var lastRequest MaintenanceRequest
	// Find the last request with this prefix
	// Order by ID desc to get the latest
	err = tx.Where("id LIKE ?", prefix+"%").Order("id desc").First(&lastRequest).Error

	nextSeq := 1001
	if err == nil {
		// Found a previous one, extract sequence
		// ID format: MR251001 (Length 6 + 2 = 8)
		if len(lastRequest.ID) >= 8 {
			lastSeqStr := lastRequest.ID[4:] // Skip "MR25"
			if lastSeq, err := strconv.Atoi(lastSeqStr); err == nil {
				nextSeq = lastSeq + 1
			}
		}
	} else if err != gorm.ErrRecordNotFound {
		// Real error
		return err
	}

	mr.ID = fmt.Sprintf("%s%d", prefix, nextSeq)
	return nil
}

type Comment struct {
	Model
	TenantID             string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	MaintenanceRequestID string    `json:"maintenanceRequestId"`
	Author               string    `json:"author"`
	Text                 string    `json:"text"`
	Timestamp            time.Time `json:"timestamp"`
}

type History struct {
	Model
	TenantID             string            `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	MaintenanceRequestID *string           `json:"maintenanceRequestId"`
	ServiceRequestID     *string           `json:"serviceRequestId"`
	Status               MaintenanceStatus `json:"status"`
	Date                 time.Time         `json:"date"`
	Note                 string            `json:"note"`
	Actor                string            `json:"actor"`
}

type Attachment struct {
	Model
	TenantID             string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	MaintenanceRequestID *string `json:"maintenanceRequestId"`
	ServiceRequestID     *string `json:"serviceRequestId"`
	QuotationID          *string `json:"quotationId"`
	Type                 string  `json:"type"`
	FileName             string  `json:"fileName"`
	URL                  string  `gorm:"type:text" json:"url"` // In a real app, this would be the S3/Cloud URL
}

// ServiceRequest
type ServiceRequest struct {
	Model
	TenantID             string       `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	RequestorID          string       `json:"requestorId"`
	ServiceType          string       `json:"serviceType"`
	VehicleID            *string      `json:"vehicleId"`
	Priority             string       `json:"priority"`
	Description          string       `json:"description"`
	Date                 time.Time    `json:"date"`
	Status               string       `json:"status"`
	MaintenanceRequestID *string      `json:"maintenanceRequestId"`
	AssignedTo           *string      `json:"assignedTo"`
	RelatedDriverID      *string      `json:"relatedDriverId"`
	Attachments          []Attachment `gorm:"foreignKey:ServiceRequestID" json:"attachments"`
	History              []History    `gorm:"foreignKey:ServiceRequestID" json:"history"` // Also adding history support while here
}

// BeforeCreate hook for ServiceRequest
func (sr *ServiceRequest) BeforeCreate(tx *gorm.DB) (err error) {
	// If ID is already set, don't generate one
	if sr.ID != "" {
		return
	}

	// Get current year short format (e.g., 25)
	currentYear := time.Now().Format("06")
	prefix := "SR" + currentYear

	var lastRequest ServiceRequest
	// Find the last request with this prefix
	// Order by ID desc to get the latest
	err = tx.Where("id LIKE ?", prefix+"%").Order("id desc").First(&lastRequest).Error

	nextSeq := 1001
	if err == nil {
		// Found a previous one, extract sequence
		// ID format: SR251001 (Length 6 + 2 = 8)
		if len(lastRequest.ID) >= 8 {
			lastSeqStr := lastRequest.ID[4:] // Skip "SR25"
			if lastSeq, err := strconv.Atoi(lastSeqStr); err == nil {
				nextSeq = lastSeq + 1
			}
		}
	} else if err != gorm.ErrRecordNotFound {
		// Real error
		return err
	}

	sr.ID = fmt.Sprintf("%s%d", prefix, nextSeq)
	return nil
}

// Alert
type Alert struct {
	Model
	TenantID        string        `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	Type            AlertType     `json:"type"`
	Title           string        `json:"title"`
	Description     string        `json:"description"`
	Severity        AlertSeverity `json:"severity"`
	DateCreated     time.Time     `json:"dateCreated"`
	RelatedEntityID string        `json:"relatedEntityId"`
	Status          ActionStatus  `json:"status"`
	AssignedTo      *string       `json:"assignedTo"`
}

// AlertConfig (Rules)
type AlertConfig struct {
	Model
	TenantID            string         `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	AlertFor            string         `json:"alertFor"`
	AlertType           string         `json:"alertType"`
	Frequency           string         `json:"frequency"`
	FrequencyValue      int            `json:"frequencyValue"`
	DueAlertThreshold   string         `json:"dueAlertThreshold"`
	ThresholdValue      int            `json:"thresholdValue"`
	NotificationEnabled bool           `json:"notificationEnabled"`
	WhatsappEnabled     bool           `json:"whatsappEnabled"`
	AssignedIDs         pq.StringArray `gorm:"type:text[]" json:"assignedIds"`
}

// Invoice
type Invoice struct {
	Model
	InvoiceNumber string            `gorm:"uniqueIndex" json:"invoiceNumber"`
	RequestID     string            `json:"requestId"`
	GarageID      string            `json:"garageId"`
	InvoiceDate   time.Time         `json:"invoiceDate"`
	DueDate       time.Time         `json:"dueDate"`
	TotalAmount   float64           `json:"totalAmount"`
	PaidAmount    float64           `json:"paidAmount"`
	PaymentStatus string            `json:"paymentStatus"`
	LineItems     []InvoiceLineItem `gorm:"foreignKey:InvoiceID" json:"lineItems"`
}

type InvoiceLineItem struct {
	Model
	InvoiceID   string  `json:"invoiceId"`
	Description string  `json:"description"`
	Quantity    int     `json:"quantity"`
	UnitPrice   float64 `json:"unitPrice"`
	TotalPrice  float64 `json:"totalPrice"`
	Category    string  `json:"category"`
}

// Quotation
type Quotation struct {
	Model
	TenantID                string             `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	QuotationDate           time.Time          `json:"quotationDate"`
	ValidUntil              time.Time          `json:"validUntil"`
	LaborCost               float64            `json:"laborCost"`
	PartsCost               float64            `json:"partsCost"`
	ConsumablesCost         float64            `json:"consumablesCost"`
	VatAmount               float64            `json:"vatAmount"`
	TotalCost               float64            `json:"totalCost"`
	GrandTotal              float64            `json:"grandTotal"`
	Currency                string             `json:"currency" gorm:"default:'AED'"`
	EstimatedDuration       int                `json:"estimatedDuration"` // hours
	EstimatedCompletionDate *time.Time         `json:"estimatedCompletionDate"`
	Status                  QuotationStatus    `json:"status"`
	SubmittedBy             string             `json:"submittedBy"`
	Notes                   string             `json:"notes"`
	MaintenanceRequestID    string             `json:"requestId"`
	MaintenanceRequest      MaintenanceRequest `gorm:"foreignKey:MaintenanceRequestID" json:"request"`
	GarageID                string             `json:"garageId"`
	Garage                  Garage             `gorm:"foreignKey:GarageID" json:"garage"`
	Parts                   []QuotationPart    `gorm:"foreignKey:QuotationID" json:"parts"`
	Labor                   []QuotationLabor   `gorm:"foreignKey:QuotationID" json:"labor"`
	Attachments             []Attachment       `gorm:"foreignKey:QuotationID" json:"attachments"`
	Revision                int                `json:"revision" gorm:"default:0"`
}

type QuotationPart struct {
	Model
	Name        string  `json:"name"`
	Quantity    int     `json:"quantity"`
	UnitPrice   float64 `json:"unitPrice"`
	TotalPrice  float64 `json:"totalPrice"`
	QuotationID string  `json:"quotationId"`
}

type QuotationLabor struct {
	Model
	Description string  `json:"description"`
	Hours       float64 `json:"hours"`
	RatePerHour float64 `json:"ratePerHour"`
	TotalPrice  float64 `json:"totalPrice"`
	QuotationID string  `json:"quotationId"`
}

type EstimateApproval struct {
	ApprovedBy     string    `json:"approvedBy"`
	ApprovedByName string    `json:"approvedByName"`
	ApprovedAt     time.Time `json:"approvedAt"`
	Comments       string    `json:"comments"`
}

// Prediction
// MaintenanceDueAlert is a single "this vehicle is due for service"
// recommendation produced by GetMaintenanceDueAlerts. Honest fields only:
// every value here is either directly read from the vehicle row, computed
// from a clearly-named rule, or derived from this vehicle's actual
// completed-maintenance history (Phase 2 fields below — all marked
// omitempty so rule-based-only alerts don't carry zero values that look
// meaningful).
//
// The old Prediction struct carried fake Confidence / CurrentCondition /
// PredictedFailureDate / EstimatedCost fields that were hardcoded
// constants. None of those names are reused here — the Phase 2 fields
// use deliberately different names (TypicalIntervalKm, ProjectedDueAt,
// SampleCount) so nobody confuses real computation with the old theater.
type MaintenanceDueAlert struct {
	VehicleID         string `json:"vehicleId"`
	VehicleName       string `json:"vehicleName"`
	Component         string `json:"component"`
	RecommendedAction string `json:"recommendedAction"`
	RiskLevel         string `json:"riskLevel"` // High, Medium, Low
	Reason            string `json:"reason"`    // human-readable: which rule fired and why
	VehicleMileage    int    `json:"vehicleMileage"`
	VehicleYear       int    `json:"vehicleYear"`

	// Source identifies how this alert was produced:
	//   "rule"       — mileage/age threshold rule fired (Phase 1)
	//   "history"    — this vehicle's own maintenance history projects
	//                  the component as overdue or due soon (Phase 2)
	//   "rule+history" — rule fired AND history projection corroborates;
	//                    the analytics fields below carry the per-vehicle
	//                    interval data.
	// UI uses this to render the right confidence-disclosure language.
	Source string `json:"source,omitempty"`

	// SampleCount is the number of completed-service intervals the
	// analytics fields were averaged over. 0 means no history was used.
	// Higher = more trustworthy; the UI should expose this so operators
	// don't act on a single-sample projection as if it were 10.
	SampleCount int `json:"sampleCount,omitempty"`

	// TypicalIntervalKm and TypicalIntervalDays are the mean km / day
	// gap between consecutive same-component services for THIS vehicle.
	// Zero when no history is available.
	TypicalIntervalKm   int `json:"typicalIntervalKm,omitempty"`
	TypicalIntervalDays int `json:"typicalIntervalDays,omitempty"`

	// LastServiceAt and LastServiceOdometer pin the most recent
	// completed service of this component on this vehicle. The "due"
	// projection counts forward from these.
	LastServiceAt       *time.Time `json:"lastServiceAt,omitempty"`
	LastServiceOdometer int        `json:"lastServiceOdometer,omitempty"`

	// ProjectedDueAtKm and ProjectedDueByDate are the forward
	// extrapolation: when the analytics expect this component will need
	// servicing next. Computed as last + typical-interval, with the
	// km-pace cross-check applied (see analytics.ProjectNextDue).
	ProjectedDueAtKm   int        `json:"projectedDueAtKm,omitempty"`
	ProjectedDueByDate *time.Time `json:"projectedDueByDate,omitempty"`
}

// RiskCounts aggregates how many distinct vehicles have at least one
// alert at each risk level. Honest because it's a count derived directly
// from the alerts above.
type RiskCounts struct {
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Healthy  int `json:"healthy"`
}

// MaintenanceDueAlertsResponse wraps the per-vehicle alerts plus the
// risk-level rollup. No more Optimization / CostForecast blocks — both
// were derived from fake PredictedFailureDate / EstimatedCost values.
// Phase 2 will reintroduce them as data-driven structures when there's
// real history to compute them from.
type MaintenanceDueAlertsResponse struct {
	Alerts     []MaintenanceDueAlert `json:"alerts"`
	RiskCounts RiskCounts            `json:"riskCounts"`
	// Disclaimer is intentionally returned in the response so any UI or
	// downstream consumer renders the right semantic label rather than
	// silently re-marketing this as ML.
	Disclaimer string `json:"disclaimer"`
}

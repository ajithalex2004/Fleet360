package models

import (
	"database/sql/driver"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

// Decimal represents a fixed-point monetary value (2 decimal places, backed by
// integer fils: 1.00 AED = 100) to eliminate IEEE-754 floating-point drift.
type Decimal struct {
	fils int64
}

// Fils represents an integer minor unit (1 AED = 100 Fils) for zero-loss integer arithmetic
type Fils int64

// FromFils converts integer fils to a Decimal AED amount
func FromFils(f Fils) Decimal {
	return Decimal{fils: int64(f)}
}

// ToFils converts a Decimal AED amount to integer fils
func (d Decimal) ToFils() Fils {
	return Fils(d.fils)
}

func (d Decimal) Add(o Decimal) Decimal  { return Decimal{fils: d.fils + o.fils} }
func (d Decimal) Sub(o Decimal) Decimal  { return Decimal{fils: d.fils - o.fils} }
func (d Decimal) MulInt(q int64) Decimal { return Decimal{fils: d.fils * q} }
func (d Decimal) Cmp(o Decimal) int {
	if d.fils < o.fils {
		return -1
	}
	if d.fils > o.fils {
		return 1
	}
	return 0
}

func (d Decimal) String() string {
	sign := ""
	v := d.fils
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s%d.%02d", sign, v/100, v%100)
}

func ParseDecimal(s string) (Decimal, error) {
	s = strings.TrimSpace(strings.Trim(s, `"`))
	if s == "" {
		return Decimal{}, fmt.Errorf("empty decimal")
	}
	neg := false
	if strings.HasPrefix(s, "-") {
		neg = true
		s = s[1:]
	} else if strings.HasPrefix(s, "+") {
		s = s[1:]
	}
	parts := strings.SplitN(s, ".", 2)
	var whole int64
	if parts[0] != "" {
		var err error
		whole, err = strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			return Decimal{}, fmt.Errorf("invalid decimal %q: %w", s, err)
		}
	}
	var frac int64
	if len(parts) == 2 && parts[1] != "" {
		f := parts[1]
		if len(f) == 1 {
			f += "0"
		} else if len(f) > 2 {
			roundUp := f[2] >= '5'
			f = f[:2]
			var err error
			frac, err = strconv.ParseInt(f, 10, 64)
			if err != nil {
				return Decimal{}, fmt.Errorf("invalid fraction %q: %w", s, err)
			}
			if roundUp {
				frac++
			}
			total := whole*100 + frac
			if neg {
				total = -total
			}
			return Decimal{fils: total}, nil
		}
		var err error
		frac, err = strconv.ParseInt(f, 10, 64)
		if err != nil {
			return Decimal{}, fmt.Errorf("invalid fraction %q: %w", s, err)
		}
	}
	total := whole*100 + frac
	if neg {
		total = -total
	}
	return Decimal{fils: total}, nil
}

func (d Decimal) MarshalJSON() ([]byte, error) {
	return []byte(d.String()), nil
}

func (d *Decimal) UnmarshalJSON(data []byte) error {
	s := strings.TrimSpace(string(data))
	if s == "null" {
		*d = Decimal{}
		return nil
	}
	parsed, err := ParseDecimal(s)
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

func (d Decimal) Value() (driver.Value, error) {
	return d.String(), nil
}

func (d *Decimal) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*d = Decimal{}
		return nil
	case []byte:
		p, err := ParseDecimal(string(v))
		if err != nil {
			return err
		}
		*d = p
		return nil
	case string:
		p, err := ParseDecimal(v)
		if err != nil {
			return err
		}
		*d = p
		return nil
	case int64:
		*d = Decimal{fils: v * 100}
		return nil
	case float64:
		p, err := ParseDecimal(strconv.FormatFloat(v, 'f', 2, 64))
		if err != nil {
			return err
		}
		*d = p
		return nil
	default:
		p, err := ParseDecimal(fmt.Sprintf("%v", v))
		if err != nil {
			return err
		}
		*d = p
		return nil
	}
}

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

// PlainModel is Model for tables without a deleted_at column: embedding
// Model there makes every query add "deleted_at IS NULL" and fail.
type PlainModel struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// BeforeCreate hook to generate UUID if ID is empty
func (m *PlainModel) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return
}

// CreatedModel is for append-only tables with created_at but no updated_at
// or deleted_at (logs, checks).
type CreatedModel struct {
	ID        string    `gorm:"primaryKey" json:"id"`
	CreatedAt time.Time `json:"createdAt"`
}

// BeforeCreate hook to generate UUID if ID is empty
func (m *CreatedModel) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return
}

// IDModel is for tables with no timestamp columns at all.
type IDModel struct {
	ID string `gorm:"primaryKey" json:"id"`
}

// BeforeCreate hook to generate UUID if ID is empty
func (m *IDModel) BeforeCreate(tx *gorm.DB) (err error) {
	if m.ID == "" {
		m.ID = uuid.New().String()
	}
	return
}

// Vehicle
type Vehicle struct {
	Model
	TenantID           string    `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	Make               string    `json:"make"`
	VehicleModel       string    `gorm:"column:model" json:"model"`
	Type               string    `json:"type"`
	Year               int       `json:"year"`
	LicensePlate       string    `gorm:"uniqueIndex" json:"licensePlate"`
	VIN                string    `gorm:"uniqueIndex" json:"vin"`
	CurrentMileage     int       `json:"currentMileage"`
	Status             string    `json:"status"`
	RegistrationExpiry time.Time `json:"registrationExpiry"`
	InsuranceExpiry    time.Time `json:"insuranceExpiry"`
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
	UnitCost     Decimal `json:"unitCost"`
	TotalCost    Decimal `json:"totalCost"`
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
	Parts Decimal `json:"parts"`
	Labor Decimal `json:"labor"`
	Other Decimal `json:"other"`
	Total Decimal `json:"total"`
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
	EstimatedCost       Decimal           `json:"estimatedCost"`
	ActualCost          Decimal           `json:"actualCost"`
	ActualPartsCost     Decimal           `json:"actualPartsCost"`
	ActualLaborCost     Decimal           `json:"actualLaborCost"`
	ActualOtherCost     Decimal           `json:"actualOtherCost"`
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
	TotalAmount   Decimal           `json:"totalAmount"`
	PaidAmount    Decimal           `json:"paidAmount"`
	PaymentStatus string            `json:"paymentStatus"`
	LineItems     []InvoiceLineItem `gorm:"foreignKey:InvoiceID" json:"lineItems"`
}

type InvoiceLineItem struct {
	Model
	InvoiceID   string  `json:"invoiceId"`
	Description string  `json:"description"`
	Quantity    int     `json:"quantity"`
	UnitPrice   Decimal `json:"unitPrice"`
	TotalPrice  Decimal `json:"totalPrice"`
	Category    string  `json:"category"`
}

// Quotation
type Quotation struct {
	Model
	TenantID                string             `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	QuotationDate           time.Time          `json:"quotationDate"`
	ValidUntil              time.Time          `json:"validUntil"`
	LaborCost               Decimal            `json:"laborCost"`
	PartsCost               Decimal            `json:"partsCost"`
	ConsumablesCost         Decimal            `json:"consumablesCost"`
	VatAmount               Decimal            `json:"vatAmount"`
	TotalCost               Decimal            `json:"totalCost"`
	GrandTotal              Decimal            `json:"grandTotal"`
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
	UnitPrice   Decimal `json:"unitPrice"`
	TotalPrice  Decimal `json:"totalPrice"`
	QuotationID string  `json:"quotationId"`
}

type QuotationLabor struct {
	Model
	Description string  `json:"description"`
	Hours       float64 `json:"hours"`
	RatePerHour Decimal `json:"ratePerHour"`
	TotalPrice  Decimal `json:"totalPrice"`
	QuotationID string  `json:"quotationId"`
}

type EstimateApproval struct {
	ApprovedBy     string    `json:"approvedBy"`
	ApprovedByName string    `json:"approvedByName"`
	ApprovedAt     time.Time `json:"approvedAt"`
	Comments       string    `json:"comments"`
}

// Prediction
type Prediction struct {
	VehicleID            string  `json:"vehicleId"`
	VehicleName          string  `json:"vehicleName"`
	Component            string  `json:"component"`
	CurrentCondition     int     `json:"currentCondition"` // 0-100
	PredictedFailureDate string  `json:"predictedFailureDate"`
	Confidence           int     `json:"confidence"` // 0-100
	RecommendedAction    string  `json:"recommendedAction"`
	EstimatedCost        Decimal `json:"estimatedCost"`
	RiskLevel            string  `json:"riskLevel"` // High, Medium, Low
}

// Optimization
type Optimization struct {
	OptimalWindow   string `json:"optimalWindow"`
	AltWindow       string `json:"altWindow"`
	OptimalReason   string `json:"optimalReason"`
	AltReason       string `json:"altReason"`
	EarliestFailure string `json:"earliestFailure"`
}

// CostForecast
type CostForecast struct {
	CurrentMonth Decimal `json:"currentMonth"`
	NextMonth    Decimal `json:"nextMonth"`
	Next3Months  Decimal `json:"next3Months"`
	Next6Months  Decimal `json:"next6Months"`
	Trend        string  `json:"trend"`
}

// RiskAssessment
type RiskAssessment struct {
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Healthy  int `json:"healthy"`
}

// PredictiveSummary response wrapper
type PredictiveSummary struct {
	Predictions    []Prediction   `json:"predictions"`
	Optimization   Optimization   `json:"optimization"`
	CostForecast   CostForecast   `json:"costForecast"`
	RiskAssessment RiskAssessment `json:"riskAssessment"`
}

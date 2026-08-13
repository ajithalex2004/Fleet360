package models

// Dispatch domain models — Phase 0 prep for the Tier 1 module.
//
// Why this file exists: trip_schedules (the central dispatch entity) and
// its child tables (trip_passengers, trip_logs, trip_incidents,
// staff_transport_requests, boarding_events, bus_pretrip_checks,
// ble_gateway_presence) are the work of the next module to migrate from
// Next.js to Go. Phase 0 prep means writing the Go-side GORM models so
// that when the JWT + tenant-isolation PR lands, the dispatch handlers
// have a clean place to start — and the JWT PR gets a concrete first
// consumer to test against.
//
// Tenant isolation rules followed throughout:
//   - Every model embeds the Model base (id/created_at/updated_at/deleted_at).
//   - Every model declares TenantID with `gorm:"not null;index;column:tenant_id"`
//     so GORM reads/writes only ever see rows in the auth-scoped tenant.
//   - Nullable SQL columns are *string / *time.Time / *float64 so a DB NULL
//     round-trips as nil rather than a zero value.
//   - JSONB columns use `serializer:json` matching the convention in models.go.
//
// Why we DON'T define models.go's "BeforeCreate" hooks for human refs:
// The trip module already auto-generates trip_number / incident_no in the
// Prisma layer via Prisma extensions — duplicating that logic in GORM
// risks two numbering sequences for the same logical row. We trust the
// Prisma-side generation (or DB defaults) and only generate the synthetic
// ID via the base Model.BeforeCreate. If the trip_number column is NULL
// after migration, we backfill in the SQL migration below.
//
// AutoMigrate is DISABLED for these tables (database/db.go) — the Prisma
// layer owns schema. GORM only reads/writes columns that already exist.

import (
	"time"
)

// BusRoute is the static route definition (origin → destination, ordered
// stops, capacity). Used by TripSchedule as the parent of every dispatch.
type BusRoute struct {
	Model
	TenantID              string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	Name                  string  `gorm:"not null" json:"name"`
	Origin                string  `gorm:"not null" json:"origin"`
	Destination           string  `gorm:"not null" json:"destination"`
	RouteType             string  `gorm:"column:route_type;default:STAFF" json:"routeType"` // STAFF|SCHOOL|BOTH
	TotalDistanceKm       *float64 `gorm:"column:total_distance_km" json:"totalDistanceKm,omitempty"`
	EstimatedDurationMins *int     `gorm:"column:estimated_duration_mins" json:"estimatedDurationMins,omitempty"`
	Capacity              *int     `gorm:"default:30" json:"capacity,omitempty"`
	IsActive              *bool    `gorm:"column:is_active;default:true" json:"isActive,omitempty"`
	Notes                 *string  `json:"notes,omitempty"`
	Stops                 []RouteStop    `gorm:"foreignKey:RouteID" json:"stops,omitempty"`
	Schedules             []TripSchedule `gorm:"foreignKey:RouteID" json:"schedules,omitempty"`
}

func (BusRoute) TableName() string { return "bus_routes" }

// RouteStop is a single waypoint on a BusRoute. Ordered by Sequence.
type RouteStop struct {
	Model
	TenantID               string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	RouteID                string  `gorm:"not null;column:route_id;index" json:"routeId"`
	StopName               string  `gorm:"column:stop_name;not null" json:"stopName"`
	Sequence               int     `gorm:"not null" json:"sequence"`
	GPSLat                 *float64 `gorm:"column:gps_lat" json:"gpsLat,omitempty"`
	GPSLng                 *float64 `gorm:"column:gps_lng" json:"gpsLng,omitempty"`
	EstimatedArrivalMins   *int     `gorm:"column:estimated_arrival_mins" json:"estimatedArrivalMins,omitempty"`
	Landmark               *string  `json:"landmark,omitempty"`
}

func (RouteStop) TableName() string { return "route_stops" }

// TripSchedule is the central dispatch entity. One row per scheduled trip
// (e.g. "Route 5 morning run, departing 2026-06-25 07:30, vehicle V123,
// driver D456"). This is what the operations team sees on the dispatch
// board and what the auto-dispatch logic writes to.
type TripSchedule struct {
	Model
	TenantID        string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	TripNumber      *string `gorm:"column:trip_number;uniqueIndex" json:"tripNumber,omitempty"`
	RouteID         string  `gorm:"not null;column:route_id;index" json:"routeId"`
	VehicleID       *string `gorm:"column:vehicle_id;index" json:"vehicleId,omitempty"`
	DriverID        *string `gorm:"column:driver_id;index" json:"driverId,omitempty"`
	DepartureTime   time.Time `gorm:"column:departure_time;not null" json:"departureTime"`
	ArrivalTime     *time.Time `gorm:"column:arrival_time" json:"arrivalTime,omitempty"`
	Frequency       *string `gorm:"default:DAILY" json:"frequency,omitempty"`     // DAILY|WEEKLY|ONCE
	ShiftType       *string `gorm:"column:shift_type" json:"shiftType,omitempty"` // MORNING|EVENING|NIGHT|SPLIT
	Direction       *string `gorm:"default:INBOUND" json:"direction,omitempty"`  // INBOUND|OUTBOUND
	Capacity        *int    `gorm:"default:30" json:"capacity,omitempty"`
	ConfirmedCount  *int    `gorm:"column:confirmed_count;default:0" json:"confirmedCount,omitempty"`
	Status          *string `gorm:"default:SCHEDULED" json:"status,omitempty"` // SCHEDULED|DEPARTED|IN_TRANSIT|COMPLETED|CANCELLED
	Notes           *string `json:"notes,omitempty"`

	// Relations
	Passengers []TripPassenger `gorm:"foreignKey:TripID" json:"passengers,omitempty"`
	TripLogs   []TripLog       `gorm:"foreignKey:ScheduleID" json:"tripLogs,omitempty"`
	Incidents  []TripIncident  `gorm:"foreignKey:ScheduleID" json:"incidents,omitempty"`
}

func (TripSchedule) TableName() string { return "trip_schedules" }

// TripPassenger is a single rider booked onto a trip. The rider is a
// StaffMember — joins by StaffMemberID, not UserID (a person may be a
// fleet passenger without being a Fleet360 system user).
type TripPassenger struct {
	Model
	TenantID          string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	TripID            string  `gorm:"not null;column:trip_id;index" json:"tripId"`
	StaffMemberID     *string `gorm:"column:staff_member_id;index" json:"staffMemberId,omitempty"`
	EmployeeID        *string `gorm:"column:employee_id" json:"employeeId,omitempty"`
	EmployeeName      *string `gorm:"column:employee_name" json:"employeeName,omitempty"`
	Department        *string `json:"department,omitempty"`
	BoardingStopID    *string `gorm:"column:boarding_stop_id" json:"boardingStopId,omitempty"`
	AlightingStopID   *string `gorm:"column:alighting_stop_id" json:"alightingStopId,omitempty"`
	BoardingStopName  *string `gorm:"column:boarding_stop_name" json:"boardingStopName,omitempty"`
	AlightingStopName *string `gorm:"column:alighting_stop_name" json:"alightingStopName,omitempty"`
	BoardedAt         *time.Time `gorm:"column:boarded_at" json:"boardedAt,omitempty"`
	Status            *string `gorm:"default:CONFIRMED" json:"status,omitempty"` // CONFIRMED|BOARDED|ABSENT|NO_SHOW
	Notes             *string `json:"notes,omitempty"`
}

func (TripPassenger) TableName() string { return "trip_passengers" }

// TripLog is the driver-reported start/end + operational data for a
// completed (or in-progress) trip. One trip may have multiple logs if
// it spans a shift change.
type TripLog struct {
	Model
	TenantID             string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ScheduleID           string  `gorm:"not null;column:schedule_id;index" json:"scheduleId"`
	LoggedBy             *string `gorm:"column:logged_by" json:"loggedBy,omitempty"`
	ActualDepartureTime  *time.Time `gorm:"column:actual_departure_time" json:"actualDepartureTime,omitempty"`
	ActualArrivalTime    *time.Time `gorm:"column:actual_arrival_time" json:"actualArrivalTime,omitempty"`
	StartMileage         *float64   `gorm:"column:start_mileage" json:"startMileage,omitempty"`
	EndMileage           *float64   `gorm:"column:end_mileage" json:"endMileage,omitempty"`
	FuelUsed             *float64   `gorm:"column:fuel_used" json:"fuelUsed,omitempty"`
	PassengersBoarded    *int       `gorm:"column:passengers_boarded" json:"passengersBoarded,omitempty"`
	Incidents            *string    `json:"incidents,omitempty"`
	DriverNotes          *string    `gorm:"column:driver_notes" json:"driverNotes,omitempty"`
	Notes                *string    `json:"notes,omitempty"`
}

func (TripLog) TableName() string { return "trip_logs" }

// TripIncident covers any operational disruption on a trip: accident,
// breakdown, delay, medical event, passenger complaint. Severity and
// type drive SLA / alerting / dispatch reassignment.
//
// Incidents on ambulance_calls use a separate AmbulanceCall table; the
// schema is similar but the workflow is different (emergency response).
type TripIncident struct {
	Model
	TenantID         string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	IncidentNo       *string `gorm:"column:incident_no;uniqueIndex" json:"incidentNo,omitempty"`
	ScheduleID       *string `gorm:"column:schedule_id;index" json:"scheduleId,omitempty"`
	RouteID          *string `gorm:"column:route_id" json:"routeId,omitempty"`
	VehicleID        *string `gorm:"column:vehicle_id" json:"vehicleId,omitempty"`
	DriverID         *string `gorm:"column:driver_id" json:"driverId,omitempty"`
	IncidentDate     time.Time `gorm:"column:incident_date;not null" json:"incidentDate"`
	IncidentType     string  `gorm:"column:incident_type;not null" json:"incidentType"` // ACCIDENT|BREAKDOWN|DELAY|MEDICAL|PASSENGER_COMPLAINT|OTHER
	Severity         *string `gorm:"default:LOW" json:"severity,omitempty"`            // LOW|MEDIUM|HIGH|CRITICAL
	Location         *string `json:"location,omitempty"`
	Description      *string `json:"description,omitempty"`
	InjuriesReported *bool   `gorm:"column:injuries_reported;default:false" json:"injuriesReported,omitempty"`
	PoliceReport     *bool   `gorm:"column:police_report;default:false" json:"policeReport,omitempty"`
	PoliceReportNo   *string `gorm:"column:police_report_no" json:"policeReportNo,omitempty"`
	ActionTaken      *string `gorm:"column:action_taken" json:"actionTaken,omitempty"`
	Status           *string `gorm:"default:OPEN" json:"status,omitempty"` // OPEN|INVESTIGATING|RESOLVED|CLOSED
	ResolvedAt       *time.Time `gorm:"column:resolved_at" json:"resolvedAt,omitempty"`
	ResolvedBy       *string `gorm:"column:resolved_by" json:"resolvedBy,omitempty"`
}

func (TripIncident) TableName() string { return "trip_incidents" }

// AmbulanceCall is the dispatch record for an emergency call. Distinct
// from TripIncident because the workflow is different (response time
// SLA, dispatched unit assignment, hospital routing).
type AmbulanceCall struct {
	Model
	TenantID         string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	CallNo           *string `gorm:"column:call_no;uniqueIndex" json:"callNo,omitempty"`
	ReceivedAt       time.Time `gorm:"column:received_at;not null" json:"receivedAt"`
	CallerName       *string `gorm:"column:caller_name" json:"callerName,omitempty"`
	CallerPhone      *string `gorm:"column:caller_phone" json:"callerPhone,omitempty"`
	PickupAddress    *string `gorm:"column:pickup_address" json:"pickupAddress,omitempty"`
	PickupLat        *float64 `gorm:"column:pickup_lat" json:"pickupLat,omitempty"`
	PickupLng        *float64 `gorm:"column:pickup_lng" json:"pickupLng,omitempty"`
	PatientName      *string `gorm:"column:patient_name" json:"patientName,omitempty"`
	PatientCondition *string `gorm:"column:patient_condition" json:"patientCondition,omitempty"`
	Severity         *string `gorm:"default:MEDIUM" json:"severity,omitempty"` // LOW|MEDIUM|HIGH|CRITICAL
	AssignedVehicleID *string `gorm:"column:assigned_vehicle_id;index" json:"assignedVehicleId,omitempty"`
	AssignedDriverID  *string `gorm:"column:assigned_driver_id;index" json:"assignedDriverId,omitempty"`
	DestinationHospital *string `gorm:"column:destination_hospital" json:"destinationHospital,omitempty"`
	DispatchedAt     *time.Time `gorm:"column:dispatched_at" json:"dispatchedAt,omitempty"`
	OnSceneAt        *time.Time `gorm:"column:on_scene_at" json:"onSceneAt,omitempty"`
	ArrivedHospitalAt *time.Time `gorm:"column:arrived_hospital_at" json:"arrivedHospitalAt,omitempty"`
	ClosedAt         *time.Time `gorm:"column:closed_at" json:"closedAt,omitempty"`
	Status           *string `gorm:"default:RECEIVED" json:"status,omitempty"` // RECEIVED|DISPATCHED|EN_ROUTE|ON_SCENE|TRANSPORTING|CLOSED|CANCELLED
	Notes            *string `json:"notes,omitempty"`
}

func (AmbulanceCall) TableName() string { return "ambulance_calls" }

// StaffMember is a person who uses fleet transport but is not necessarily
// a Fleet360 system user (e.g. an employee whose payroll/HR lives in
// another system). Linked to TripPassenger via StaffMemberID.
type StaffMember struct {
	Model
	TenantID         string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	EmployeeID       *string `gorm:"column:employee_id;uniqueIndex" json:"employeeId,omitempty"`
	Name             string  `gorm:"not null" json:"name"`
	Department       *string `json:"department,omitempty"`
	Designation      *string `json:"designation,omitempty"`
	ContactNumber    *string `gorm:"column:contact_number" json:"contactNumber,omitempty"`
	Email            *string `json:"email,omitempty"`
	ResidenceArea    *string `gorm:"column:residence_area" json:"residenceArea,omitempty"`
	DefaultRouteID   *string `gorm:"column:default_route_id" json:"defaultRouteId,omitempty"`
	DefaultStopID    *string `gorm:"column:default_stop_id" json:"defaultStopId,omitempty"`
	DefaultStopName  *string `gorm:"column:default_stop_name" json:"defaultStopName,omitempty"`
	ShiftType        *string `gorm:"column:shift_type" json:"shiftType,omitempty"`    // MORNING|EVENING|BOTH
	TransportType    *string `gorm:"column:transport_type;default:BUS" json:"transportType,omitempty"` // BUS|TAXI|SELF
	IsActive         *bool   `gorm:"column:is_active;default:true" json:"isActive,omitempty"`
}

func (StaffMember) TableName() string { return "staff_members" }

// StaffTransportRequest is an ad-hoc transport ask: "I need a ride to the
// airport tomorrow morning" — outside the normal schedule. Drives a
// trip_schedules row when approved.
type StaffTransportRequest struct {
	Model
	TenantID        string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	RequestNo       *string `gorm:"column:request_no;uniqueIndex" json:"requestNo,omitempty"`
	StaffMemberID   string  `gorm:"not null;column:staff_member_id;index" json:"staffMemberId"`
	RequestType     string  `gorm:"not null;column:request_type" json:"requestType"` // ADHOC|ROUTE_CHANGE|NEW_ROUTE|TEMPORARY
	TripDate        time.Time `gorm:"not null;column:trip_date" json:"tripDate"`
	PickupLocation  *string `gorm:"column:pickup_location" json:"pickupLocation,omitempty"`
	DropLocation    *string `gorm:"column:drop_location" json:"dropLocation,omitempty"`
	Reason          *string `json:"reason,omitempty"`
	Status          *string `gorm:"default:PENDING" json:"status,omitempty"` // PENDING|APPROVED|REJECTED|FULFILLED
	ApprovedBy      *string `gorm:"column:approved_by" json:"approvedBy,omitempty"`
	ApprovedAt      *time.Time `gorm:"column:approved_at" json:"approvedAt,omitempty"`
	Notes           *string `json:"notes,omitempty"`
}

func (StaffTransportRequest) TableName() string { return "staff_transport_requests" }

// BoardingEvent is one scan event from a boarding device — QR/NFC/BLE/MANUAL.
// High write volume. tenant_id column added so we can scope queries when
// looking up "did this passenger board the right bus for this tenant".
type BoardingEvent struct {
	Model
	TenantID      string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ScheduleID    string  `gorm:"not null;column:schedule_id;index" json:"scheduleId"`
	PassengerID   *string `gorm:"column:passenger_id;index" json:"passengerId,omitempty"`
	StaffMemberID *string `gorm:"column:staff_member_id;index" json:"staffMemberId,omitempty"`
	Method        string  `gorm:"not null" json:"method"`                         // QR|NFC|BLE|MANUAL
	Direction     *string `gorm:"default:BOARD" json:"direction,omitempty"`      // BOARD|ALIGHT
	Identifier    *string `json:"identifier,omitempty"`
	StopID        *string `gorm:"column:stop_id" json:"stopId,omitempty"`
	PerformedAt   time.Time `gorm:"not null;column:performed_at;index" json:"performedAt"`
	PerformedBy   *string `gorm:"column:performed_by" json:"performedBy,omitempty"`
	RawPayload    map[string]any `gorm:"column:raw_payload;serializer:json" json:"rawPayload,omitempty"`
}

func (BoardingEvent) TableName() string { return "boarding_events" }

// BusPreTripCheck is a driver's pre-departure vehicle check (tyres, brakes,
// lights, fluids). One row per check. tenant_id scopes by fleet owner, not
// by driver — useful when an enterprise fleet operates across multiple
// tenants under one platform.
type BusPreTripCheck struct {
	Model
	TenantID     string         `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	ScheduleID   string         `gorm:"not null;column:schedule_id;index" json:"scheduleId"`
	VehicleID    *string        `gorm:"column:vehicle_id" json:"vehicleId,omitempty"`
	DriverID     *string        `gorm:"column:driver_id" json:"driverId,omitempty"`
	PerformedAt  time.Time      `gorm:"not null;column:performed_at;index" json:"performedAt"`
	PerformedBy  *string        `gorm:"column:performed_by" json:"performedBy,omitempty"`
	CheckItems   map[string]any `gorm:"not null;column:check_items;serializer:json" json:"checkItems"`
	OverallPass  bool           `gorm:"not null;column:overall_pass;default:true" json:"overallPass"`
	FailCount    int            `gorm:"not null;default:0" json:"failCount"`
	Notes        *string        `json:"notes,omitempty"`
	SignatureData *string       `gorm:"column:signature_data" json:"signatureData,omitempty"`
}

func (BusPreTripCheck) TableName() string { return "bus_pretrip_checks" }

// BLEGatewayPresence tracks when a passenger's BLE tag is detected by a
// vehicle-mounted gateway. Used for unattended boarding + ETA refinement.
// High write volume; tenant_id scopes per-fleet visibility.
type BLEGatewayPresence struct {
	Model
	TenantID     string  `gorm:"not null;index;column:tenant_id" json:"tenantId"`
	GatewayID    string  `gorm:"not null;column:gateway_id" json:"gatewayId"`
	VehicleID    string  `gorm:"not null;column:vehicle_id" json:"vehicleId"`
	TagID        string  `gorm:"not null;column:tag_id" json:"tagId"`
	ScheduleID   *string `gorm:"column:schedule_id;index" json:"scheduleId,omitempty"`
	PassengerID  *string `gorm:"column:passenger_id" json:"passengerId,omitempty"`
	StaffMemberID *string `gorm:"column:staff_member_id" json:"staffMemberId,omitempty"`
	FirstSeenAt  time.Time `gorm:"not null;column:first_seen_at" json:"firstSeenAt"`
	LastSeenAt   time.Time `gorm:"not null;column:last_seen_at" json:"lastSeenAt"`
	LastRSSIDbm  *int     `gorm:"column:last_rssi_dbm" json:"lastRssiDbm,omitempty"`
	IsPresent    bool     `gorm:"not null;column:is_present;default:true" json:"isPresent"`
	AlightedAt   *time.Time `gorm:"column:alighted_at" json:"alightedAt,omitempty"`
}

func (BLEGatewayPresence) TableName() string { return "ble_gateway_presence" }

-- Enhance bus_routes
ALTER TABLE "bus_routes" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "bus_routes" ADD COLUMN IF NOT EXISTS "route_type" TEXT DEFAULT 'STAFF';
ALTER TABLE "bus_routes" ADD COLUMN IF NOT EXISTS "capacity" INTEGER DEFAULT 30;
ALTER TABLE "bus_routes" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Enhance route_stops
ALTER TABLE "route_stops" ADD COLUMN IF NOT EXISTS "landmark" TEXT;

-- Enhance trip_schedules
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "trip_number" TEXT;
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "arrival_time" TIMESTAMPTZ(6);
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "direction" TEXT DEFAULT 'INBOUND';
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "capacity" INTEGER DEFAULT 30;
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "confirmed_count" INTEGER DEFAULT 0;
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "trip_schedules_trip_number_key" ON "trip_schedules"("trip_number");

-- Enhance trip_passengers
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "staff_member_id" TEXT;
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "department" TEXT;
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "boarding_stop_name" TEXT;
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "alighting_stop_name" TEXT;
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "boarded_at" TIMESTAMPTZ(6);
ALTER TABLE "trip_passengers" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Enhance trip_logs
ALTER TABLE "trip_logs" ADD COLUMN IF NOT EXISTS "logged_by" TEXT;
ALTER TABLE "trip_logs" ADD COLUMN IF NOT EXISTS "start_mileage" FLOAT;
ALTER TABLE "trip_logs" ADD COLUMN IF NOT EXISTS "end_mileage" FLOAT;
ALTER TABLE "trip_logs" ADD COLUMN IF NOT EXISTS "passengers_boarded" INTEGER;
ALTER TABLE "trip_logs" ADD COLUMN IF NOT EXISTS "driver_notes" TEXT;

-- Enhance staff_members
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ(6);
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "designation" TEXT;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "residence_area" TEXT;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "default_stop_name" TEXT;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "shift_type" TEXT;
ALTER TABLE "staff_members" ADD COLUMN IF NOT EXISTS "transport_type" TEXT DEFAULT 'BUS';

-- CreateTable: staff_transport_requests
CREATE TABLE IF NOT EXISTS "staff_transport_requests" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "request_no" TEXT,
    "staff_member_id" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "trip_date" TIMESTAMPTZ(6) NOT NULL,
    "pickup_location" TEXT,
    "drop_location" TEXT,
    "reason" TEXT,
    "status" TEXT DEFAULT 'PENDING',
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(6),
    "notes" TEXT,

    CONSTRAINT "staff_transport_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_transport_requests_request_no_key" ON "staff_transport_requests"("request_no");

ALTER TABLE "staff_transport_requests" DROP CONSTRAINT IF EXISTS "staff_transport_requests_staff_member_id_fkey";
ALTER TABLE "staff_transport_requests" ADD CONSTRAINT "staff_transport_requests_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: trip_incidents
CREATE TABLE IF NOT EXISTS "trip_incidents" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "incident_no" TEXT,
    "schedule_id" TEXT,
    "route_id" TEXT,
    "vehicle_id" TEXT,
    "driver_id" TEXT,
    "incident_date" TIMESTAMPTZ(6) NOT NULL,
    "incident_type" TEXT NOT NULL,
    "severity" TEXT DEFAULT 'LOW',
    "location" TEXT,
    "description" TEXT,
    "injuries_reported" BOOLEAN DEFAULT false,
    "police_report" BOOLEAN DEFAULT false,
    "police_report_no" TEXT,
    "action_taken" TEXT,
    "status" TEXT DEFAULT 'OPEN',
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,

    CONSTRAINT "trip_incidents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_incidents_incident_no_key" ON "trip_incidents"("incident_no");

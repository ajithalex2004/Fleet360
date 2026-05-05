-- tenant_settings table
CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6),
    "tenant_id" TEXT NOT NULL,
    "trip_merging_enabled" BOOLEAN NOT NULL DEFAULT false,
    "pickup_match_type" TEXT DEFAULT 'DISTANCE', "pickup_distance_km" DECIMAL DEFAULT 7,
    "pickup_time_window_min" INTEGER DEFAULT 30, "require_dropoff_match" BOOLEAN NOT NULL DEFAULT true,
    "dropoff_match_type" TEXT DEFAULT 'DISTANCE', "dropoff_distance_km" DECIMAL DEFAULT 25,
    "dropoff_time_window_min" INTEGER DEFAULT 30, "max_passengers" INTEGER DEFAULT 5,
    "travel_speed_kmh" DECIMAL DEFAULT 40, "stop_duration_min" INTEGER DEFAULT 10,
    "max_pickup_delay_min" INTEGER DEFAULT 30,
    "auto_merge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "trigger_before_pickup_min" INTEGER DEFAULT 30, "look_ahead_hours" INTEGER DEFAULT 24,
    "auto_dispatch_enabled" BOOLEAN NOT NULL DEFAULT false,
    "max_driver_attempts" INTEGER DEFAULT 3, "driver_response_timeout_min" INTEGER DEFAULT 6,
    "dispatch_radius" DECIMAL DEFAULT 10, "prefer_nearest_driver" BOOLEAN NOT NULL DEFAULT true,
    "route_optimization_enabled" BOOLEAN NOT NULL DEFAULT false,
    "routing_engine" TEXT DEFAULT 'GOOGLE_MAPS', "google_maps_api_key" TEXT,
    "max_api_calls_per_hour" INTEGER DEFAULT 500, "max_api_calls_per_day" INTEGER DEFAULT 5000,
    "road_distance_multiplier" DECIMAL DEFAULT 1.5, "fallback_to_straight_line" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "smtp_host" TEXT, "smtp_port" TEXT DEFAULT '587', "smtp_user" TEXT, "smtp_pass" TEXT,
    "smtp_from_email" TEXT, "smtp_from_name" TEXT,
    "sms_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sms_provider" TEXT, "sms_api_key" TEXT, "sms_from_number" TEXT,
    "push_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notification_preferences" TEXT, "trip_reminder_timing_min" INTEGER DEFAULT 60,
    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");
ALTER TABLE "tenant_settings" DROP CONSTRAINT IF EXISTS "ts_tenant_fk";
ALTER TABLE "tenant_settings" ADD CONSTRAINT "ts_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enhance lease_inquiries with vehicle groups/makes/models
ALTER TABLE "lease_inquiries" ADD COLUMN IF NOT EXISTS "vehicle_groups" TEXT;
ALTER TABLE "lease_inquiries" ADD COLUMN IF NOT EXISTS "vehicle_makes" TEXT;
ALTER TABLE "lease_inquiries" ADD COLUMN IF NOT EXISTS "vehicle_models" TEXT;

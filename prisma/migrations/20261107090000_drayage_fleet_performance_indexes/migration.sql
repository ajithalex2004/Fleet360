-- Performance & Scalability Composite Indexes for Port & Container Drayage,
-- Fleet Vehicles/Drivers, and Live Telematics (fleet.bus_gps_pings).
--
-- Eliminates full-table scans and in-memory sorts on tenant-scoped workspaces,
-- driver vehicle resolution, public customer tracking, and GPS ping lookups.

-- 1. logistics_drayage_jobs
CREATE INDEX IF NOT EXISTS idx_drayage_jobs_tenant_created
  ON public.logistics_drayage_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drayage_jobs_tenant_status_updated
  ON public.logistics_drayage_jobs (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_drayage_jobs_tenant_driver_status
  ON public.logistics_drayage_jobs (tenant_id, assigned_driver_id, status);

CREATE INDEX IF NOT EXISTS idx_drayage_jobs_tenant_job_code
  ON public.logistics_drayage_jobs (tenant_id, job_code);

CREATE INDEX IF NOT EXISTS idx_drayage_jobs_tenant_container
  ON public.logistics_drayage_jobs (tenant_id, container_number);

-- 2. logistics_drayage_containers
CREATE INDEX IF NOT EXISTS idx_drayage_containers_tenant_updated
  ON public.logistics_drayage_containers (tenant_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_drayage_containers_tenant_number
  ON public.logistics_drayage_containers (tenant_id, container_number);

-- 3. logistics_drayage_status_logs
CREATE INDEX IF NOT EXISTS idx_drayage_status_logs_tenant_created
  ON public.logistics_drayage_status_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drayage_status_logs_tenant_job
  ON public.logistics_drayage_status_logs (tenant_id, job_id, created_at DESC);

-- 4. logistics_drayage_messages
CREATE INDEX IF NOT EXISTS idx_drayage_messages_tenant_created
  ON public.logistics_drayage_messages (tenant_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_drayage_messages_tenant_job
  ON public.logistics_drayage_messages (tenant_id, job_id, created_at ASC);

-- 5. logistics_drayage_allowances
CREATE INDEX IF NOT EXISTS idx_drayage_allowances_tenant_created
  ON public.logistics_drayage_allowances (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drayage_allowances_tenant_driver
  ON public.logistics_drayage_allowances (tenant_id, driver_id, status);

-- 6. vehicles & drivers (fast driver-to-vehicle login & dispatch resolution)
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_assigned_driver
  ON public.vehicles (tenant_id, assigned_driver_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_usage_status
  ON public.vehicles (tenant_id, vehicle_usage, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_tenant_email_lower
  ON public.drivers (tenant_id, LOWER(email))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_tenant_assigned_vehicle
  ON public.drivers (tenant_id, assigned_vehicle_id)
  WHERE deleted_at IS NULL;

-- 7. fleet.bus_gps_pings (latest telemetry lookup per vehicle)
CREATE INDEX IF NOT EXISTS idx_bus_gps_pings_tenant_veh_occurred
  ON fleet.bus_gps_pings (tenant_id, vehicle_id, occurred_at DESC);

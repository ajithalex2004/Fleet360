-- Add return_terminal_id and return_terminal_name to logistics_drayage_jobs and logistics_drayage_containers
-- Allows changing the L2 empty container return terminal after exiting the port on L1 (EN_ROUTE_WAREHOUSE -> PLACED_AT_RAMP/YARD -> READY_FOR_PICKUP -> L2 PENDING)
-- while preserving the original L1 pickup terminal for audit and Smart Analysis matching.

ALTER TABLE logistics_drayage_jobs
  ADD COLUMN IF NOT EXISTS return_terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS return_terminal_name TEXT;

ALTER TABLE logistics_drayage_containers
  ADD COLUMN IF NOT EXISTS return_terminal_id TEXT,
  ADD COLUMN IF NOT EXISTS return_terminal_name TEXT;

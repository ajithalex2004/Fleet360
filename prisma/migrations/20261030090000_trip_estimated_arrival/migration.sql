-- Live ETA gets its own column.
--
-- The telematics geofence evaluator wrote its rolling ETA into
-- trip_schedules.arrival_time, the scheduled arrival. The SLA monitor
-- compares its prediction against arrival_time as the plan, so after the
-- first ping the "planned" arrival was the prediction itself and the delay
-- was always ~0: at-risk / delayed trips were never flagged, and the
-- scheduled time was lost for on-time reporting and the overdue sweep.
--
-- arrival_time is the schedule again; estimated_arrival_time holds the
-- live estimate. Rows already overwritten cannot be recovered here.
--
-- Safe to re-run.

ALTER TABLE trip_schedules ADD COLUMN IF NOT EXISTS estimated_arrival_time TIMESTAMPTZ;

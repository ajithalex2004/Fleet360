-- Add trip-lifecycle values to the NotificationEvent enum.
--
-- Postgres 12+ ADD VALUE IF NOT EXISTS makes this idempotent per label,
-- but the ALTER can't run inside a transaction that also uses the enum,
-- so this file only alters and does no other DDL.

ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_SCHEDULED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_CANCELLED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_DEPARTED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_ARRIVING';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_DELAYED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'TRIP_COMPLETED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'VEHICLE_CHANGED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'DRIVER_CHANGED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'BOARDING_MISSED';

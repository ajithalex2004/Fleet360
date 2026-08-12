-- Migration: 20260811120000_add_qc_notification_events
-- Adds four QC-workflow values to the NotificationEvent enum so that
-- operators can configure NotificationRule entries for maintenance QC transitions.
-- Applied via: npx prisma db execute (ALTER TYPE cannot run through migrate dev
-- while the shadow-database replay of 20260623160000 is blocked by the
-- CREATE TYPE IF NOT EXISTS syntax issue in that reconstructed migration).

ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'REPAIR_COMPLETED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'QUALITY_INSPECTION_STARTED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'INSPECTION_FAILED';
ALTER TYPE "NotificationEvent" ADD VALUE IF NOT EXISTS 'VEHICLE_READY_FOR_SERVICE';

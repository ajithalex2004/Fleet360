-- Migration: rename finance_anomaly_flags → agent_anomaly_flags
-- Rationale: the table is owned by the Agents domain; the finance_ prefix
-- was a naming accident. All write paths and the DDL live in src/lib/agents/.
-- The finance anomalies UI consumes the table read-only via /api/agents/anomalies.

ALTER TABLE finance_anomaly_flags RENAME TO agent_anomaly_flags;

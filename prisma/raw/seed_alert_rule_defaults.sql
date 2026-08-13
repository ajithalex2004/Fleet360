-- Seed default AlertRule rows for every existing tenant × every alert code.
--
-- Rules are keyed on (tenant_id, code) — idempotent via ON CONFLICT DO
-- NOTHING, so re-running never overwrites operator-tuned rules.
-- Operators change severity / channels / recipients / SLA later via the
-- admin UI or a direct UPDATE.
--
-- Channel tokens (`PUSH` / `SMS` / `WHATSAPP` / `EMAIL` / `IN_APP`) match
-- the values TripNotificationDispatchConsumer + AlertEngineConsumer put
-- into NotificationLog.type. Downstream channel workers key off those
-- strings, so the tokens must stay stable.
--
-- Recipient tokens are role names the downstream send pipeline resolves
-- to actual addresses / device tokens: FLEET_MANAGER, OPS_LEAD,
-- DISPATCHER, DRIVER, PASSENGER, ADMIN. Add CUSTOM ids via
-- specific_recipient_ids when a per-condition targeted person is needed.

INSERT INTO public.alert_rules (
  id, tenant_id, code,
  default_severity, default_channels, recipient_types, specific_recipient_ids,
  sla_ack_minutes, sla_resolve_minutes
)
SELECT
  gen_random_uuid()::text,
  t.id::text,
  d.code,
  d.severity,
  d.channels,
  d.recipient_types,
  '{}'::text[],
  d.sla_ack,
  d.sla_resolve
FROM public.tenants t
CROSS JOIN (VALUES
  -- code                severity   channels                                        recipient_types                                  sla_ack   sla_resolve
  ('VEHICLE_BREAKDOWN',  'HIGH',    ARRAY['PUSH','SMS','EMAIL']::text[],           ARRAY['FLEET_MANAGER','OPS_LEAD','DRIVER']::text[],   5,       240),
  ('PASSENGER_ABSENT',   'LOW',     ARRAY['IN_APP','EMAIL']::text[],               ARRAY['OPS_LEAD']::text[],                            30,      1440),
  ('LATE_DEPARTURE',     'MEDIUM',  ARRAY['PUSH','IN_APP']::text[],                ARRAY['OPS_LEAD','DISPATCHER','PASSENGER']::text[],   10,      120),
  ('LATE_ARRIVAL',       'MEDIUM',  ARRAY['PUSH']::text[],                         ARRAY['PASSENGER']::text[],                           10,      NULL::int),
  ('CAPACITY_EXCEEDED',  'HIGH',    ARRAY['PUSH','SMS']::text[],                   ARRAY['FLEET_MANAGER','OPS_LEAD']::text[],            5,       120),
  ('TRIP_OVERDUE',       'HIGH',    ARRAY['PUSH','SMS','EMAIL']::text[],           ARRAY['OPS_LEAD','FLEET_MANAGER']::text[],            5,       30),
  -- Not yet published by any code path — rules pre-seeded so the moment
  -- the publisher lands, delivery works with no ops intervention.
  ('VEHICLE_OFFLINE',    'MEDIUM',  ARRAY['IN_APP','EMAIL']::text[],               ARRAY['OPS_LEAD']::text[],                            15,      60),
  ('MISSED_STOP',        'LOW',     ARRAY['IN_APP']::text[],                       ARRAY['OPS_LEAD','PASSENGER']::text[],                30,      NULL::int),
  ('DRIVER_ABSENT',      'HIGH',    ARRAY['PUSH','SMS']::text[],                   ARRAY['OPS_LEAD','FLEET_MANAGER','DRIVER']::text[],   5,       30),
  ('ROUTE_DEVIATION',    'MEDIUM',  ARRAY['PUSH']::text[],                         ARRAY['OPS_LEAD']::text[],                            10,      60)
) AS d(code, severity, channels, recipient_types, sla_ack, sla_resolve)
WHERE COALESCE(t.is_active, TRUE) = TRUE
ON CONFLICT (tenant_id, code) DO NOTHING;

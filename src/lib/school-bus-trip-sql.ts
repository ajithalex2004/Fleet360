/**
 * SQL for reading school_bus_trips under the field names the school-bus
 * APIs return.
 *
 * The table (prisma/migrations/20260910000019_school_bus_tables_and_rls)
 * stores a trip's schedule as `scheduled_date DATE` + `scheduled_start TIME`,
 * its times as `actual_start` / `actual_end`, and its session as `session`.
 * Several routes queried `scheduled_departure`, `actual_departure`,
 * `actual_arrival` and `session_type` instead, which don't exist (42703),
 * and their `.catch(() => [])` turned that into "no trips".
 *
 * These expressions keep the response fields the pages already read.
 */

/** Scheduled departure as local ISO text (`2026-09-26T06:45:00`), NULL when no start time is set. */
export function scheduledDepartureSql(alias: string): string {
  return `to_char(${alias}.scheduled_date + ${alias}.scheduled_start, 'YYYY-MM-DD"T"HH24:MI:SS')`;
}

/** Trip columns under the API's field names: session_type, scheduled_departure, actual_departure, actual_arrival. */
export function tripScheduleColumnsSql(alias: string): string {
  return [
    `${alias}.session AS session_type`,
    `${scheduledDepartureSql(alias)} AS scheduled_departure`,
    `${alias}.actual_start::text AS actual_departure`,
    `${alias}.actual_end::text AS actual_arrival`,
  ].join(', ');
}

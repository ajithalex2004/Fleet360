# Follow-up: drop deprecated transport columns from `workforce.employees`

**Status**: blocked (audit risk #4). Cannot land in the current PR — see readers below.

## Background

Task 3 of the schema-domain-split epic (`259c5593`) split bus-ops-specific
transport preferences off `StaffMember` into `public.transport_enrollments`.
Data was backfilled but the source columns were **kept in place** on
`workforce.employees` to avoid breaking existing readers.

Columns still on `workforce.employees` (deprecated, to be dropped):

- `default_route_id`
- `default_stop_id`
- `default_stop_name`
- `shift_type`
- `transport_type`

## Blockers — readers that must migrate to TransportEnrollment first

1. **`src/app/api/bus-ops/passenger/today/route.ts:96-99`**
   Returns `staff.shiftType / defaultRouteId / defaultStopId / defaultStopName`
   in the response payload. Must resolve from the employee's active
   `TransportEnrollment` instead.

2. **`src/app/(app)/bus-ops/passenger/app/page.tsx:316, 507`**
   Reads `today.staff.defaultStopName` for display. Depends on fix #1.

3. **`src/app/(app)/bus-ops/staff/page.tsx` (full CRUD)**
   Form binds `defaultRouteId`, `defaultStopName`, `shiftType`,
   `transportType` on the StaffMember object. Line-item breaks — page
   currently CRUDs the deprecated columns directly.

   Fix: split the Staff admin page's transport prefs into a separate
   TransportEnrollment CRUD section that writes to the new endpoint
   (already available at `/api/bus-ops/transport-enrollments`).

## When all three above are done

```sql
ALTER TABLE workforce.employees
  DROP COLUMN default_route_id,
  DROP COLUMN default_stop_id,
  DROP COLUMN default_stop_name,
  DROP COLUMN shift_type,
  DROP COLUMN transport_type;
```

And remove the same fields from the Prisma `StaffMember` model.

## Related follow-up

- Rename Prisma model `StaffMember` → `Employee` (10 files) — do together
  with this or immediately before. Model name mismatch (`StaffMember`
  vs table `workforce.employees`) confuses every new developer.

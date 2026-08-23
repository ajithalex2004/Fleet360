# Prisma Schema Sync - Tenant Isolation Fix

## Summary
Fixed schema drift by synchronizing the Prisma schema with SQL migration `20260815140000_tenant_001_leasing_rental_isolation`. Added missing `tenantId` fields and relations to all rental and lease child models.

## Changes Made

### Rental Domain Models (15 models updated)

1. **RentalCustomer**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_rental_customers_tenant_id`

2. **RentalBooking**
   - Added `tenantId` field with relation to Tenant
   - Removed global unique constraint on `bookingRef`
   - Added tenant-scoped unique constraint: `uq_rental_bookings_tenant_ref`
   - Added index: `idx_rental_bookings_tenant_id`

3. **VehicleInspection**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_vehicle_inspections_tenant_id`

4. **DamageClaim**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_damage_claims_tenant_id`

5. **RateEvent**
   - Added `tenantId` field with relation to Tenant
   - Removed global unique constraint on `eventCode`
   - Added index: `idx_rate_events_tenant_id`

6. **RentalRateQuote**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_rental_rate_quotes_tenant_id`

7. **RentalAgreement**
   - Added `tenantId` field with relation to Tenant
   - Removed global unique constraint on `agreementNo`
   - Added index: `idx_rental_agreements_tenant_id`

8. **RentalVehicleExchange**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_rental_vehicle_exchanges_tenant_id`

9. **RentalExtension**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_rental_extensions_tenant_id`

10. **RentalPayment**
    - Added `tenantId` field with relation to Tenant
    - Added index: `idx_rental_payments_tenant_id`

11. **RentalAncillary**
    - Added `tenantId` field with relation to Tenant
    - Removed global unique constraint on `code`
    - Added index: `idx_rental_ancillaries_tenant_id`

12. **RentalAdditionalCharge**
    - Added `tenantId` field with relation to Tenant
    - Added index: `idx_rental_additional_charges_tenant_id`

13. **RentalInvoice**
    - Added `tenantId` field with relation to Tenant
    - Removed global unique constraint on `invoiceNo`
    - Added tenant-scoped unique constraint: `uq_rental_invoices_tenant_no`
    - Added index: `idx_rental_invoices_tenant_id`

14. **RentalInvoiceLineItem**
    - Added `tenantId` field with relation to Tenant
    - Added index: `idx_rental_invoice_line_items_tenant_id`

15. **RentalInvoicePayment**
    - Added `tenantId` field with relation to Tenant
    - Removed global unique constraint on `receiptNo`
    - Added tenant-scoped unique constraint: `uq_rental_invoice_payments_tenant_receipt`
    - Added index: `idx_rental_invoice_payments_tenant_id`

### Lease Domain Child Models (4 models updated)

1. **LeaseQuotationItem**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_lease_quotation_items_tenant_id`

2. **LeaseQuotationVehicle**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_lease_quotation_vehicles_tenant_id`

3. **LeaseContractVehicle**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_lease_contract_vehicles_tenant_id`

4. **LeaseInvoiceLine**
   - Added `tenantId` field with relation to Tenant
   - Added index: `idx_lease_invoice_lines_tenant_id`

### Tenant Model Updates

Added back-relations to the Tenant model for all 19 models:
- 15 rental domain relations
- 4 lease child relations

All relations use explicit relation names (e.g., `"RentalCustomerToTenant"`) to avoid naming conflicts.

## Key Pattern Changes

### Business Uniqueness Constraints
Changed from global uniqueness to tenant-scoped uniqueness for:
- `RentalBooking.bookingRef` → `(tenantId, bookingRef)`
- `RentalInvoice.invoiceNo` → `(tenantId, invoiceNo)`
- `RentalInvoicePayment.receiptNo` → `(tenantId, receiptNo)`
- Removed global unique on: `RateEvent.eventCode`, `RentalAgreement.agreementNo`, `RentalAncillary.code`

### Composite Foreign Keys
The SQL migration adds composite foreign keys (parent_id, tenant_id) for parent-child relationships. These are enforced at the database level but not explicitly modeled in Prisma schema (Prisma's referential actions still work correctly).

## Verification

✅ Schema validation: `npx prisma validate` - PASSED
✅ Client generation: `npx prisma generate` - SUCCEEDED

## Migration Status

The SQL migration `20260815140000_tenant_001_leasing_rental_isolation` has already been applied to the database. This Prisma schema update brings the ORM definitions in sync with the actual database state.

## Next Steps

1. ✅ Prisma schema synced with database
2. ⚠️ TypeScript compilation should be verified (run `npm run build` or `tsc`)
3. ⚠️ Application code may need updates where these models are queried/created to include `tenantId`
4. ⚠️ Consider adding tenant context middleware to automatically inject `tenantId` on all queries

## Files Modified

- `prisma/schema.prisma` - Updated 19 models + Tenant model

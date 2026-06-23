import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function exists(file: string) {
  return fs.existsSync(path.join(root, file));
}

describe('Logistics maturity slice', () => {
  it('adds canonical rate, scorecard, telematics, and accessorial domain tables', () => {
    const domain = source('src/lib/logistics/domain.ts');

    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_rate_contracts');
    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_carrier_scorecards');
    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_telematics_events');
    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_accessorial_catalog');
    expect(domain).toContain('idx_logistics_rate_contracts_lane');
    expect(domain).toContain('idx_logistics_telematics_shipment_time');
  });

  it('exposes the new Logistics control-plane APIs', () => {
    [
      'src/app/api/logistics/rate-contracts/route.ts',
      'src/app/api/logistics/carrier-scorecards/route.ts',
      'src/app/api/logistics/control-tower/route.ts',
      'src/app/api/logistics/customer-tracking/route.ts',
      'src/app/api/logistics/telematics/route.ts',
      'src/app/api/logistics/accessorials/route.ts',
      'src/app/api/logistics/shipments/[id]/accessorials/route.ts',
      'src/app/api/logistics/finance-reconciliation/route.ts',
    ].forEach(file => expect(exists(file), file).toBe(true));

    const telematicsRoute = source('src/app/api/logistics/telematics/route.ts');
    expect(telematicsRoute).toContain('recordTelematicsEvent');
    expect(telematicsRoute).toContain('Tenant boundary violation');
  });

  it('adds user-visible Logistics pages and navigation entries', () => {
    [
      'src/app/logistics/control-tower/page.tsx',
      'src/app/logistics/rate-contracts/page.tsx',
      'src/app/logistics/carrier-scorecards/page.tsx',
      'src/app/logistics/customer-tracking/page.tsx',
      'src/app/logistics/accessorials/page.tsx',
      'src/app/logistics/finance-reconciliation/page.tsx',
    ].forEach(file => expect(exists(file), file).toBe(true));

    const layout = source('src/app/logistics/layout.tsx');
    expect(layout).toContain('/logistics/control-tower');
    expect(layout).toContain('/logistics/rate-contracts');
    expect(layout).toContain('/logistics/carrier-scorecards');
    expect(layout).toContain('/logistics/customer-tracking');
    expect(layout).toContain('/logistics/finance-reconciliation');
  });

  it('keeps customer tracking safe from internal settlement data', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const customerPage = source('src/app/logistics/customer-tracking/page.tsx');

    expect(domain).toContain('getCustomerShipmentPortal');
    expect(domain).toContain('podStatus');
    expect(domain).toContain('latestEtaAt');
    expect(customerPage).toContain('Customer-safe shipment visibility');
    expect(customerPage).not.toContain('carrierPayable');
    expect(customerPage).not.toContain('settlement');
  });

  it('links accessorial charges into shipment finance reconciliation', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const reconciliationPage = source('src/app/logistics/finance-reconciliation/page.tsx');

    expect(domain).toContain('addShipmentAccessorialCharge');
    expect(domain).toContain('ACCESSORIAL_CHARGE_ADDED');
    expect(domain).toContain('getLogisticsFinanceReconciliation');
    expect(reconciliationPage).toContain('accessorialTotal');
    expect(reconciliationPage).toContain('Customer OK');
    expect(reconciliationPage).toContain('Carrier OK');
  });

  it('allows customer-specific RFQ and carrier-bidding policy', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const marketplacePage = source('src/app/logistics/marketplace/page.tsx');
    const carrierPortalPage = source('src/app/carrier-portal/logistics/page.tsx');

    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_customer_marketplace_settings');
    expect(domain).toContain('upsertCustomerMarketplaceSettings');
    expect(domain).toContain('assertCustomerAllowsRfq');
    expect(domain).toContain('assertCustomerAllowsBidSubmission');
    expect(domain).toContain('customerMarketplacePolicy');
    expect(exists('src/app/api/logistics/customer-marketplace-settings/route.ts')).toBe(true);
    expect(marketplacePage).toContain('Customer marketplace policy');
    expect(marketplacePage).toContain('Carrier bid submission is disabled for');
    expect(carrierPortalPage).toContain('Bid submission is disabled for this cargo owner.');
  });

  it('adds Logistics operations governance tables, validation, audit history, and APIs', () => {
    const domain = source('src/lib/logistics/domain.ts');

    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_master_data');
    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_shift_handovers');
    expect(domain).toContain('CREATE TABLE IF NOT EXISTS logistics_change_history');
    expect(domain).toContain('validateShipmentTimeline');
    expect(domain).toContain('LogisticsValidationError');
    expect(domain).toContain('recordLogisticsFieldOpsEvent');
    expect(domain).toContain('getLogisticsOperationsPulse');

    [
      'src/app/api/logistics/master-data/route.ts',
      'src/app/api/logistics/shift-handovers/route.ts',
      'src/app/api/logistics/shift-handovers/[id]/accept/route.ts',
      'src/app/api/logistics/field-ops/route.ts',
      'src/app/api/logistics/operations-pulse/route.ts',
      'src/app/api/logistics/change-history/route.ts',
      'src/app/api/logistics/shipments/validate/route.ts',
    ].forEach(file => expect(exists(file), file).toBe(true));
  });

  it('adds Logistics governance UI surfaces and PWA field-ops shell', () => {
    [
      'src/app/logistics/master-data/page.tsx',
      'src/app/logistics/shift-handovers/page.tsx',
      'src/app/logistics/field-ops/page.tsx',
      'public/logistics-field-manifest.json',
      'public/logistics-field-sw.js',
    ].forEach(file => expect(exists(file), file).toBe(true));

    const layout = source('src/app/logistics/layout.tsx');
    const controlTower = source('src/app/logistics/control-tower/page.tsx');
    const fieldOps = source('src/app/logistics/field-ops/page.tsx');

    expect(layout).toContain('/logistics/master-data');
    expect(layout).toContain('/logistics/shift-handovers');
    expect(layout).toContain('/logistics/field-ops');
    expect(controlTower).toContain('useLogisticsPolling(loadData');
    expect(fieldOps).toContain('navigator.serviceWorker.register');
    expect(fieldOps).toContain('/logistics-field-manifest.json');
  });

  it('drives Logistics shipment forms from master data and validates timelines before save', () => {
    const helper = source('src/components/logistics/master-data-fields.tsx');
    const dispatch = source('src/app/logistics/dispatch/page.tsx');
    const quotes = source('src/app/logistics/quotes/page.tsx');

    expect(helper).toContain('useLogisticsMasterData');
    expect(helper).toContain('validateShipmentPayload');
    expect(helper).toContain('ShipmentValidationSummary');
    expect(dispatch).toContain("useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE'])");
    expect(dispatch).toContain('validateShipmentPayload(shipmentPayload');
    expect(dispatch).toContain('Pickup Ready');
    expect(dispatch).toContain('Delivery Deadline');
    expect(source('src/lib/logistics/domain.ts')).toContain('Shipment delivery ETA cannot be earlier than pickup deadline.');
    expect(quotes).toContain("useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE', 'VEHICLE_TYPE'])");
    expect(quotes).toContain('serviceTypeOptions.length ? serviceTypeOptions');
    expect(quotes).toContain('vehicleTypeOptions.map');
    expect(quotes).toContain('Select customer / shipper');
  });

  it('extends governed shipment validation to edit, marketplace, and control tower writes', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const trips = source('src/app/logistics/trips/page.tsx');
    const marketplace = source('src/app/logistics/marketplace/page.tsx');
    const controlTower = source('src/app/logistics/control-tower/page.tsx');

    expect(exists('src/app/api/logistics/shipments/[id]/route.ts')).toBe(true);
    expect(domain).toContain('updateShipmentOrder');
    expect(domain).toContain('GOVERNED_LOGISTICS_UI');
    expect(trips).toContain('Governed shipment detail');
    expect(trips).toContain('Save governed shipment');
    expect(marketplace).toContain('Create Marketplace Shipment');
    expect(marketplace).toContain('validateShipmentPayload(selectedShipmentValidationPayload');
    expect(controlTower).toContain('Governed Update -');
    expect(controlTower).toContain('/api/logistics/field-ops');
    expect(controlTower).toContain('control-tower-governed-update');
  });

  it('hardens Logistics operational writes on the server side', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const apiContext = source('src/lib/logistics/api-context.ts');
    const assignmentsRoute = source('src/app/api/logistics/shipments/[id]/assignments/route.ts');
    const awardRoute = source('src/app/api/logistics/rfqs/[id]/award/route.ts');
    const fieldOpsRoute = source('src/app/api/logistics/field-ops/route.ts');
    const tripStatusRoute = source('src/app/api/logistics/trips/[id]/status/route.ts');
    const podRoute = source('src/app/api/logistics/trips/[id]/pod/route.ts');
    const telematicsRoute = source('src/app/api/logistics/telematics/route.ts');
    const rfqInvitesRoute = source('src/app/api/logistics/rfqs/[id]/invites/route.ts');
    const carrierDocumentsRoute = source('src/app/api/logistics/carriers/[id]/documents/route.ts');
    const carrierPortalDocumentsRoute = source('src/app/api/logistics/carrier-portal/invites/[token]/documents/route.ts');
    const manifestRoute = source('src/app/api/logistics/trips/[id]/manifest/route.ts');
    const tripDocumentsRoute = source('src/app/api/logistics/trips/[id]/documents/route.ts');
    const quotesRoute = source('src/app/api/logistics/quotes/route.ts');
    const backfillRoute = source('src/app/api/logistics/shipments/backfill/route.ts');

    expect(domain).toContain('export async function assertGovernedShipmentWrite');
    expect(domain).toContain('assertShipmentMasterDataGovernance');
    expect(domain).toContain('must be selected from active Logistics master data.');
    expect(domain).toContain('Vehicle type');
    expect(domain).toContain('assertCarrierDocumentDates');
    expect(domain).toContain('RFQ creation');
    expect(domain).toContain('Carrier bid submission');
    expect(domain).toContain('Carrier invite creation');
    expect(domain).toContain('Carrier invite revocation');
    expect(domain).toContain('Shipment assignment');
    expect(domain).toContain('Carrier compliance blocks shipment assignment');
    expect(domain).toContain('Carrier award');
    expect(domain).toContain('Field operations update');
    expect(domain).toContain('Telematics event');
    expect(domain).toContain('Finance settlement posting');
    expect(domain).toContain('Finance posting reversal');
    expect(domain).toContain('Reversal reason is required for Logistics Finance postings.');
    expect(domain).toContain('PLATFORM_COMMISSION');
    expect(domain).toContain('Exception action ${action.replace');
    expect(domain).toContain('Telematics latitude must be between -90 and 90.');
    expect(domain).toContain('Longitude must be between -180 and 180.');

    expect(apiContext).toContain("error.code === 'LOGISTICS_COMPLIANCE_BLOCKED'");
    expect(apiContext).toContain('validation.statusCode ?? 422');
    expect(assignmentsRoute).toContain('overrideCompliance');
    expect(assignmentsRoute).toContain('actorRole: ctx.role');
    expect(assignmentsRoute).toContain("logisticsErrorResponse(error, 'Failed to create shipment assignment')");
    expect(awardRoute).toContain("logisticsErrorResponse(error, 'Failed to award carrier bid')");
    expect(fieldOpsRoute).toContain("logisticsErrorResponse(error, 'Failed to record field operations event')");
    expect(tripStatusRoute).toContain('assertGovernedShipmentWrite');
    expect(podRoute).toContain('POD submission');
    expect(podRoute).toContain('POD recipient name is required.');
    expect(podRoute).toContain('POD has already been submitted for this trip.');
    expect(telematicsRoute).toContain("logisticsErrorResponse(error, 'Failed to ingest telematics event')");
    expect(rfqInvitesRoute).toContain("logisticsErrorResponse(error, 'Failed to create carrier invite')");
    expect(carrierDocumentsRoute).toContain("logisticsErrorResponse(error, 'Failed to upload carrier document')");
    expect(carrierPortalDocumentsRoute).toContain("logisticsErrorResponse(error, 'Failed to upload carrier document')");
    expect(manifestRoute).toContain('assertManifestPayload');
    expect(manifestRoute).toContain('Manifest stop deletion');
    expect(tripDocumentsRoute).toContain('Trip document mutation');
    expect(tripDocumentsRoute).toContain('Document expiry date cannot be before issue date.');
    expect(tripDocumentsRoute).toContain('Attach a file or provide a file URL.');
    expect(quotesRoute).toContain('Distance must be greater than zero.');
    expect(backfillRoute).toContain('Backfill limit must be between 1 and 1000.');
  });

  it('adds Logistics exception lifecycle, controlled pickers, compliance UI, and realtime polling', () => {
    const domain = source('src/lib/logistics/domain.ts');
    const helper = source('src/components/logistics/master-data-fields.tsx');
    const controlTower = source('src/app/logistics/control-tower/page.tsx');
    const marketplace = source('src/app/logistics/marketplace/page.tsx');
    const carrierPortal = source('src/app/carrier-portal/logistics/page.tsx');
    const dispatch = source('src/app/logistics/dispatch/page.tsx');

    expect(domain).toContain('assigned_to TEXT');
    expect(domain).toContain('sla_breached_at TIMESTAMPTZ');
    expect(domain).toContain('export async function listShipmentExceptions');
    expect(domain).toContain('export async function updateShipmentExceptionLifecycle');
    expect(domain).toContain('MARK_SLA_BREACHED');
    expect(domain).toContain('EXCEPTION_${next.status}');
    expect(exists('src/app/api/logistics/exceptions/route.ts')).toBe(true);
    expect(exists('src/app/api/logistics/exceptions/[id]/route.ts')).toBe(true);

    expect(helper).toContain('export function LogisticsMasterSelect');
    expect(helper).toContain('export function useLogisticsPolling');
    expect(controlTower).toContain('/api/logistics/exceptions');
    expect(controlTower).toContain('Exception lifecycle');
    expect(controlTower).toContain('Needs Attention');
    expect(controlTower).toContain('Operational timeline');
    expect(controlTower).toContain('/api/logistics/shipments/${shipmentId}/timeline');
    expect(controlTower).toContain('useLogisticsPolling(loadData');
    expect(controlTower).toContain('ASSIGN');
    expect(controlTower).toContain('ACKNOWLEDGE');
    expect(controlTower).toContain('ESCALATE');
    expect(controlTower).toContain('RESOLVE');

    expect(marketplace).toContain("useLogisticsMasterData(['CUSTOMER', 'SHIPPER', 'PICKUP_LOCATION', 'AIRPORT', 'COUNTRY', 'SERVICE_TYPE', 'VEHICLE_TYPE'])");
    expect(marketplace).toContain('DEFAULT_VEHICLE_TYPE_OPTIONS');
    expect(marketplace).toContain('vehicleTypeOptions.map');
    expect(marketplace).toContain('Select linked driver');
    expect(marketplace).toContain('useLogisticsPolling(refreshAll');
    expect(carrierPortal).toContain('useLogisticsPolling(loadRfqs');
    expect(dispatch).toContain("useLogisticsMasterData(['PICKUP_LOCATION', 'AIRPORT', 'COUNTRY'])");
    expect(dispatch).toContain('Select origin');
    expect(dispatch).toContain('Select destination');
  });
});

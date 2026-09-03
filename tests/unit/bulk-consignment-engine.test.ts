import { describe, it, expect } from 'vitest';
import {
  parseBulkConsignmentsCsv,
  clusterConsignmentsIntoRoutes,
  analyzeBulkConsignmentUpload,
  SAMPLE_BULK_CSV_CONTENT,
} from '@/lib/bulk-consignment-engine';

describe('B2B Bulk Consignment Excel / CSV Uploader & Auto-Clustering Engine', () => {
  it('parses sample CSV rows and validates all required consignment headers', () => {
    const rows = parseBulkConsignmentsCsv(SAMPLE_BULK_CSV_CONTENT);

    expect(rows.length).toBe(10);
    expect(rows[0].consignmentRef).toBe('CON-DXB-001');
    expect(rows[0].consigneeName).toBe('Dubai Mall Store');
    expect(rows[0].palletCount).toBe(4);
    expect(rows[0].grossWeightKg).toBe(1850);
    expect(rows[0].cargoCategory).toContain('Frozen Pharma');
    expect(rows[0].isValid).toBe(true);
  });

  it('clusters consignments into regional corridors and assigns appropriate vehicle capacities', () => {
    const rows = parseBulkConsignmentsCsv(SAMPLE_BULK_CSV_CONTENT);
    const clusters = clusterConsignmentsIntoRoutes(rows);

    expect(clusters.length).toBe(3);

    // Cluster 1: Dubai Metro Reefer (Dubai Mall, MOE, Dubai Hills, DCC)
    const dxb = clusters.find((c) => c.clusterId === 'ROUTE-DXB-REEFER-01');
    expect(dxb).toBeDefined();
    expect(dxb?.vehicleRecommended).toContain('7-Ton Multi-Temp Reefer');
    expect(dxb?.totalConsignments).toBe(4);

    // Cluster 2: Abu Dhabi Capital (Abu Dhabi Mall, Yas Mall, Al Ain Mall)
    const auh = clusters.find((c) => c.clusterId === 'ROUTE-AUH-CAPITAL-02');
    expect(auh).toBeDefined();
    expect(auh?.vehicleRecommended).toContain('14-Ton Heavy Curtain-Sider');
    expect(auh?.totalConsignments).toBe(3);

    // Cluster 3: Northern Emirates (Sharjah, Mirdif, RAK)
    const nor = clusters.find((c) => c.clusterId === 'ROUTE-NOR-EMIRATES-03');
    expect(nor).toBeDefined();
    expect(nor?.vehicleRecommended).toContain('7-Ton Heavy Dry Cargo Box');
    expect(nor?.totalConsignments).toBe(3);
  });

  it('analyzes entire batch, calculates totals, and generates a SHA-256 batch cryptographic seal', () => {
    const analysis = analyzeBulkConsignmentUpload('sample_retail_manifest.csv', SAMPLE_BULK_CSV_CONTENT);

    expect(analysis.totalRows).toBe(10);
    expect(analysis.validRowsCount).toBe(10);
    expect(analysis.totalPallets).toBe(38); // 4+3+6+4+2+5+3+2+5+4 = 38
    expect(analysis.masterManifestNumber).toContain('MAN-BULK-');
    expect(analysis.cryptographicBatchSeal).toHaveLength(64); // SHA-256
    expect(analysis.summaryPricingAed).toBeGreaterThan(3000);
  });
});

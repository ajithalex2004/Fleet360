import crypto from 'crypto';

export interface BulkConsignmentRow {
  consignmentRef: string;
  shipperName: string;
  originLocation: string;
  consigneeName: string;
  destinationAddress: string;
  deliveryDate: string;
  timeWindowStart: string;
  timeWindowEnd: string;
  palletCount: number;
  grossWeightKg: number;
  cargoCategory: string;
  customsDecNo: string;
  receiverContactName: string;
  receiverPhone: string;
  costCenter: string;
  isValid: boolean;
  validationErrors: string[];
}

export interface ClusteredVehicleRoute {
  clusterId: string;
  corridorName: string;
  vehicleRecommended: string;
  vehicleMaxCapacityPallets: number;
  totalConsignments: number;
  totalPallets: number;
  totalWeightKg: number;
  capacityUtilizationPercent: number;
  stopsSequence: { stopNo: number; consigneeName: string; address: string; timeWindow: string; pallets: number }[];
  consignments: BulkConsignmentRow[];
  estimatedDistanceKm: number;
  estimatedSalikTollsAed: number;
  totalFreightFareAed: number;
  co2SavingsKg: number;
}

export interface BulkUploadAnalysisResult {
  fileName: string;
  totalRows: number;
  validRowsCount: number;
  invalidRowsCount: number;
  totalPallets: number;
  totalWeightKg: number;
  clusters: ClusteredVehicleRoute[];
  masterManifestNumber: string;
  cryptographicBatchSeal: string;
  summaryPricingAed: number;
}

export const SAMPLE_BULK_CSV_CONTENT = `Consignment_Ref,Shipper_Name,Origin_Location,Consignee_Name,Destination_Address,Delivery_Date,Time_Window_Start,Time_Window_End,Pallet_Count,Gross_Weight_Kg,Cargo_Category,Customs_Dec_No,Receiver_Contact_Name,Receiver_Phone,Cost_Center
CON-DXB-001,EIN360 General Trading,JAFZA Gate 4,Dubai Mall Store,Dubai Mall Service Dock 3,2026-09-08,06:00,09:30,4,1850,Frozen Pharma (-18°C),DEC-DXB-CUST-2026-098842,Rashid Al-Mansoori,+971501234567,CC-EIN360-RETAIL-01
CON-DXB-002,EIN360 General Trading,JAFZA Gate 4,Mall of the Emirates,MOE Logistics Loading Bay 2,2026-09-08,07:00,10:00,3,1200,Frozen Pharma (-18°C),DEC-DXB-CUST-2026-098843,Tariq Qasim,+971552345678,CC-EIN360-RETAIL-01
CON-DXB-003,EIN360 General Trading,JAFZA Gate 4,Abu Dhabi Mall,Abu Dhabi Central Dock 1,2026-09-08,09:00,12:00,6,2400,Dry Retail,DEC-DXB-CUST-2026-098844,Zubair Khan,+971523456789,CC-EIN360-RETAIL-02
CON-DXB-004,EIN360 General Trading,JAFZA Gate 4,Yas Mall Store,Yas Mall Service Bay 4,2026-09-08,10:30,13:30,4,1600,Dry Retail,DEC-DXB-CUST-2026-098845,Faisal Al-Zaabi,+971504567890,CC-EIN360-RETAIL-02
CON-DXB-005,EIN360 General Trading,JAFZA Gate 4,Dubai Hills Mall,Dubai Hills Loading Bay C,2026-09-08,06:30,09:00,2,850,Chilled Dairy (+4°C),DEC-DXB-CUST-2026-098846,Omar Al-Hashimi,+971565678901,CC-EIN360-FOOD-01
CON-DXB-006,EIN360 General Trading,JAFZA Gate 4,Sharjah City Centre,Sharjah Retail Dock 2,2026-09-08,07:30,10:30,5,1950,Dry Retail,DEC-DXB-CUST-2026-098847,Ibrahim Noor,+971506789012,CC-EIN360-RETAIL-03
CON-DXB-007,EIN360 General Trading,JAFZA Gate 4,Mirdif City Centre,Mirdif Service Dock North,2026-09-08,08:00,11:00,3,1100,Dry Retail,DEC-DXB-CUST-2026-098848,Khaled Mansoor,+971557890123,CC-EIN360-RETAIL-03
CON-DXB-008,EIN360 General Trading,JAFZA Gate 4,Deira City Centre,DCC Cargo Gate 1,2026-09-08,06:00,08:30,2,780,Frozen Pharma (-18°C),DEC-DXB-CUST-2026-098849,Nasser Al-Falasi,+971528901234,CC-EIN360-PHARMA-01
CON-DXB-009,EIN360 General Trading,JAFZA Gate 4,Al Ain Mall Store,Al Ain Main Receiving Bay,2026-09-08,11:00,14:00,5,2100,Dry Retail,DEC-DXB-CUST-2026-098850,Salem Al-Nuaimi,+971509012345,CC-EIN360-RETAIL-02
CON-DXB-010,EIN360 General Trading,JAFZA Gate 4,RAK Al Hamra Mall,Al Hamra Logistics Dock,2026-09-08,12:00,15:00,4,1500,Dry Retail,DEC-DXB-CUST-2026-098851,Hassan Al-Shehhi,+971550123456,CC-EIN360-RETAIL-03`;

/**
 * Parses raw CSV text into structured consignment rows with field validation
 */
export function parseBulkConsignmentsCsv(csvText: string): BulkConsignmentRow[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const rows: BulkConsignmentRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 5) continue;

    const errors: string[] = [];

    const consignmentRef = cols[0] || `CON-DXB-${Math.floor(100 + Math.random() * 900)}`;
    const shipperName = cols[1] || 'EIN360 General Trading LLC';
    const originLocation = cols[2] || 'JAFZA Logistics Base Gate 4';
    const consigneeName = cols[3] || 'Retail Destination';
    const destinationAddress = cols[4] || 'Dubai';
    const deliveryDate = cols[5] || new Date().toISOString().split('T')[0];
    const timeWindowStart = cols[6] || '08:00';
    const timeWindowEnd = cols[7] || '12:00';
    const palletCount = parseInt(cols[8], 10) || 1;
    const grossWeightKg = parseFloat(cols[9]) || 500;
    const cargoCategory = cols[10] || 'Dry Retail';
    const customsDecNo = cols[11] || 'DEC-DXB-CUST-2026-098842';
    const receiverContactName = cols[12] || 'Store Receiving Manager';
    const receiverPhone = cols[13] || '+971 50 123 4567';
    const costCenter = cols[14] || 'CC-EIN360-DEFAULT';

    if (!consigneeName) errors.push('Missing Consignee Name');
    if (!destinationAddress) errors.push('Missing Destination Address');
    if (palletCount <= 0) errors.push('Pallet count must be at least 1');

    rows.push({
      consignmentRef,
      shipperName,
      originLocation,
      consigneeName,
      destinationAddress,
      deliveryDate,
      timeWindowStart,
      timeWindowEnd,
      palletCount,
      grossWeightKg,
      cargoCategory,
      customsDecNo,
      receiverContactName,
      receiverPhone,
      costCenter,
      isValid: errors.length === 0,
      validationErrors: errors,
    });
  }

  return rows;
}

/**
 * Clusters individual consignments into consolidated regional vehicle routes
 */
export function clusterConsignmentsIntoRoutes(rows: BulkConsignmentRow[]): ClusteredVehicleRoute[] {
  const validRows = rows.filter((r) => r.isValid);
  if (validRows.length === 0) return [];

  const dxbGroup: BulkConsignmentRow[] = [];
  const auhGroup: BulkConsignmentRow[] = [];
  const norGroup: BulkConsignmentRow[] = [];

  for (const row of validRows) {
    const dest = (row.destinationAddress + ' ' + row.consigneeName).toLowerCase();
    if (dest.includes('abu dhabi') || dest.includes('yas') || dest.includes('al ain')) {
      auhGroup.push(row);
    } else if (dest.includes('sharjah') || dest.includes('rak') || dest.includes('mirdif')) {
      norGroup.push(row);
    } else {
      dxbGroup.push(row);
    }
  }

  const clusters: ClusteredVehicleRoute[] = [];

  // Helper to build a cluster object
  const createCluster = (
    clusterId: string,
    corridorName: string,
    vehicleRecommended: string,
    maxPallets: number,
    baseKm: number,
    baseFare: number,
    items: BulkConsignmentRow[]
  ): ClusteredVehicleRoute => {
    const totalPallets = items.reduce((sum, item) => sum + item.palletCount, 0);
    const totalWeightKg = items.reduce((sum, item) => sum + item.grossWeightKg, 0);
    const capacityUtilizationPercent = Math.min(100, Math.round((totalPallets / maxPallets) * 100));

    const stopsSequence = items.map((item, idx) => ({
      stopNo: idx + 1,
      consigneeName: item.consigneeName,
      address: item.destinationAddress,
      timeWindow: `${item.timeWindowStart} - ${item.timeWindowEnd}`,
      pallets: item.palletCount,
    }));

    const salikTollsAed = items.length * 8; // 2 salik gates per delivery leg
    const totalFreightFareAed = baseFare + items.length * 120 + salikTollsAed;
    const co2SavingsKg = Math.round(items.length * 18.5); // ~18.5kg CO2 saved per consolidated drop

    return {
      clusterId,
      corridorName,
      vehicleRecommended,
      vehicleMaxCapacityPallets: maxPallets,
      totalConsignments: items.length,
      totalPallets,
      totalWeightKg,
      capacityUtilizationPercent,
      stopsSequence,
      consignments: items,
      estimatedDistanceKm: baseKm + items.length * 8,
      estimatedSalikTollsAed: salikTollsAed,
      totalFreightFareAed,
      co2SavingsKg,
    };
  };

  if (dxbGroup.length > 0) {
    clusters.push(
      createCluster(
        'ROUTE-DXB-REEFER-01',
        'Dubai Metro & Downtown Reefer Corridor',
        '7-Ton Multi-Temp Reefer Truck (14 Pallets)',
        14,
        45,
        750,
        dxbGroup
      )
    );
  }

  if (auhGroup.length > 0) {
    clusters.push(
      createCluster(
        'ROUTE-AUH-CAPITAL-02',
        'Abu Dhabi Capital Regional Corridor',
        '14-Ton Heavy Curtain-Sider (18 Pallets)',
        18,
        145,
        1450,
        auhGroup
      )
    );
  }

  if (norGroup.length > 0) {
    clusters.push(
      createCluster(
        'ROUTE-NOR-EMIRATES-03',
        'Northern Emirates (Sharjah & RAK) Route',
        '7-Ton Heavy Dry Cargo Box (14 Pallets)',
        14,
        110,
        950,
        norGroup
      )
    );
  }

  return clusters;
}

/**
 * Complete analysis pipeline: parse CSV, validate, cluster, and compute SHA-256 batch seal
 */
export function analyzeBulkConsignmentUpload(
  fileName: string = 'consignment_manifest.csv',
  csvContent: string = SAMPLE_BULK_CSV_CONTENT
): BulkUploadAnalysisResult {
  const rows = parseBulkConsignmentsCsv(csvContent);
  const validRows = rows.filter((r) => r.isValid);
  const invalidRows = rows.filter((r) => !r.isValid);
  const clusters = clusterConsignmentsIntoRoutes(rows);

  const totalPallets = validRows.reduce((sum, r) => sum + r.palletCount, 0);
  const totalWeightKg = validRows.reduce((sum, r) => sum + r.grossWeightKg, 0);
  const summaryPricingAed = clusters.reduce((sum, c) => sum + c.totalFreightFareAed, 0);
  const masterManifestNumber = `MAN-BULK-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const batchHashData = JSON.stringify({
    masterManifestNumber,
    totalRows: rows.length,
    validRowsCount: validRows.length,
    totalPallets,
    totalWeightKg,
    clusters: clusters.map((c) => ({ id: c.clusterId, stops: c.stopsSequence.length })),
  });
  const cryptographicBatchSeal = crypto.createHash('sha256').update(batchHashData).digest('hex');

  return {
    fileName,
    totalRows: rows.length,
    validRowsCount: validRows.length,
    invalidRowsCount: invalidRows.length,
    totalPallets,
    totalWeightKg,
    clusters,
    masterManifestNumber,
    cryptographicBatchSeal,
    summaryPricingAed,
  };
}

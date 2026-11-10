export interface ConsolidationShipmentCandidate {
  shipmentRef: string;
  shipperName: string;
  originCorridor: string;
  destinationCorridor: string;
  pickupDate: string;
  weightKg: number;
  volumeCbm: number;
  palletCount: number;
  cargoType: string;
  standaloneRateAed: number;
}

export interface ConsolidatedLoadGroup {
  groupId: string;
  corridor: string;
  shipments: ConsolidationShipmentCandidate[];
  combinedWeightKg: number;
  combinedVolumeCbm: number;
  combinedPallets: number;
  weightUtilizationPct: number;
  volumeUtilizationPct: number;
  standaloneTotalAed: number;
  consolidatedRateAed: number;
  savingsAed: number;
  co2SavedKg: number;
}

export const SAMPLE_CONSOLIDATION_CANDIDATES: ConsolidationShipmentCandidate[] = [
  {
    shipmentRef: 'SHP-LTL-401',
    shipperName: 'Al-Futtaim Logistics LLC',
    originCorridor: 'JAFZA South',
    destinationCorridor: 'Abu Dhabi / KEZAD',
    pickupDate: '2026-11-06',
    weightKg: 4800,
    volumeCbm: 22,
    palletCount: 8,
    cargoType: 'Dry Retail',
    standaloneRateAed: 1450,
  },
  {
    shipmentRef: 'SHP-LTL-402',
    shipperName: 'Landmark Retail Distribution',
    originCorridor: 'JAFZA South',
    destinationCorridor: 'Abu Dhabi / KEZAD',
    pickupDate: '2026-11-06',
    weightKg: 5400,
    volumeCbm: 26,
    palletCount: 10,
    cargoType: 'Dry Retail',
    standaloneRateAed: 1550,
  },
  {
    shipmentRef: 'SHP-LTL-403',
    shipperName: 'Chalhoub Luxury Supply Chain',
    originCorridor: 'Dubai South (DWC)',
    destinationCorridor: 'Sharjah / Northern Emirates',
    pickupDate: '2026-11-06',
    weightKg: 3200,
    volumeCbm: 16,
    palletCount: 6,
    cargoType: 'FMCG',
    standaloneRateAed: 980,
  },
  {
    shipmentRef: 'SHP-LTL-404',
    shipperName: 'EIN360 General Trading',
    originCorridor: 'Dubai South (DWC)',
    destinationCorridor: 'Sharjah / Northern Emirates',
    pickupDate: '2026-11-06',
    weightKg: 4100,
    volumeCbm: 19,
    palletCount: 7,
    cargoType: 'FMCG',
    standaloneRateAed: 1050,
  },
];

export function matchConsolidatedBackhaulLoads(
  candidates: ConsolidationShipmentCandidate[],
  maxWeightKg = 15000,
  maxVolumeCbm = 65,
) {
  const byCorridor = new Map<string, ConsolidationShipmentCandidate[]>();
  for (const item of candidates) {
    const key = `${item.originCorridor} → ${item.destinationCorridor}`;
    const list = byCorridor.get(key) ?? [];
    list.push(item);
    byCorridor.set(key, list);
  }

  const groups: ConsolidatedLoadGroup[] = [];
  let idx = 1;

  for (const [corridor, items] of byCorridor.entries()) {
    let bucket: ConsolidationShipmentCandidate[] = [];
    let currentWeight = 0;
    let currentVolume = 0;

    const flush = () => {
      if (bucket.length === 0) return;
      const combinedWeightKg = bucket.reduce((s, x) => s + Number(x.weightKg || 0), 0);
      const combinedVolumeCbm = bucket.reduce((s, x) => s + Number(x.volumeCbm || 0), 0);
      const combinedPallets = bucket.reduce((s, x) => s + Number(x.palletCount || 0), 0);
      const standaloneTotalAed = bucket.reduce((s, x) => s + Number(x.standaloneRateAed || 0), 0);
      const discountFactor = bucket.length > 1 ? 0.76 : 1;
      const consolidatedRateAed = Math.round(standaloneTotalAed * discountFactor);
      const savingsAed = Math.max(0, standaloneTotalAed - consolidatedRateAed);

      groups.push({
        groupId: `CONS-GRP-${String(idx++).padStart(2, '0')}`,
        corridor,
        shipments: bucket,
        combinedWeightKg,
        combinedVolumeCbm,
        combinedPallets,
        weightUtilizationPct: Math.min(100, Math.round((combinedWeightKg / Math.max(maxWeightKg, 1)) * 100)),
        volumeUtilizationPct: Math.min(100, Math.round((combinedVolumeCbm / Math.max(maxVolumeCbm, 1)) * 100)),
        standaloneTotalAed,
        consolidatedRateAed,
        savingsAed,
        co2SavedKg: bucket.length > 1 ? (bucket.length - 1) * 42 : 0,
      });
      bucket = [];
      currentWeight = 0;
      currentVolume = 0;
    };

    for (const item of items) {
      const w = Number(item.weightKg || 0);
      const v = Number(item.volumeCbm || 0);
      if (bucket.length > 0 && (currentWeight + w > maxWeightKg || currentVolume + v > maxVolumeCbm)) {
        flush();
      }
      bucket.push(item);
      currentWeight += w;
      currentVolume += v;
    }
    flush();
  }

  const totalSavingsAed = groups.reduce((s, g) => s + g.savingsAed, 0);
  const totalCo2SavedKg = groups.reduce((s, g) => s + g.co2SavedKg, 0);

  return {
    totalCandidates: candidates.length,
    consolidatedGroupsCount: groups.length,
    maxWeightKg,
    maxVolumeCbm,
    totalSavingsAed,
    totalCo2SavedKg,
    groups,
  };
}

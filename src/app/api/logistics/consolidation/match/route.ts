export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export interface ActiveConsolidationPool {
  poolId: string;
  corridorName: string;
  truckClass: string;
  totalCapacityPallets: number;
  allocatedPallets: number;
  availablePallets: number;
  totalCapacityTons: number;
  allocatedTons: number;
  availableTons: number;
  discountPercent: number;
  scheduledDeparture: string;
  activeShippers: string[];
}

export const ACTIVE_CONSOLIDATION_POOLS: ActiveConsolidationPool[] = [
  {
    poolId: 'POOL-E11-DXB-AUH-01',
    corridorName: 'JAFZA Base ➔ Dubai Mall ➔ Abu Dhabi Kizad (E11)',
    truckClass: '7-Ton Curtain Sider',
    totalCapacityPallets: 10,
    allocatedPallets: 4,
    availablePallets: 6,
    totalCapacityTons: 7.0,
    allocatedTons: 2.8,
    availableTons: 4.2,
    discountPercent: 20,
    scheduledDeparture: '2026-09-03T16:00:00.000Z',
    activeShippers: ['EIN360', 'Chalhoub Group'],
  },
  {
    poolId: 'POOL-E311-DXB-SHJ-02',
    corridorName: 'DSO Tech Depot ➔ Deira ➔ Sharjah SAIF Zone (E311)',
    truckClass: '3-Ton Reefer Box (-18°C)',
    totalCapacityPallets: 6,
    allocatedPallets: 2,
    availablePallets: 4,
    totalCapacityTons: 3.0,
    allocatedTons: 1.1,
    availableTons: 1.9,
    discountPercent: 15,
    scheduledDeparture: '2026-09-03T17:30:00.000Z',
    activeShippers: ['Emaar Properties'],
  },
];

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    pools: ACTIVE_CONSOLIDATION_POOLS,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { pallets = 2, weightTons = 1.0, corridor = 'E11' } = body;

    const matchedPool = ACTIVE_CONSOLIDATION_POOLS.find(
      (p) =>
        p.availablePallets >= Number(pallets) &&
        p.availableTons >= Number(weightTons)
    ) || ACTIVE_CONSOLIDATION_POOLS[0];

    return NextResponse.json({
      success: true,
      eligible: true,
      pool: matchedPool,
      estimatedSavingsAed: Math.round(550 * (matchedPool.discountPercent / 100)),
      co2ReductionKg: 18.5,
    });
  } catch (err) {
    console.error('[api/logistics/consolidation/match POST]', err);
    return NextResponse.json({ error: 'Failed to match consolidation pool' }, { status: 500 });
  }
}

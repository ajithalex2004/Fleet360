import { NextRequest, NextResponse } from 'next/server';
import { 
  generateScope3AuditCertificate, 
  EsgTripInput 
} from '@/lib/esg/scope3-carbon-calculator';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sustainability/scope3-report
 * Generates an Audit-Ready GHG Protocol Scope 3 Carbon Certificate & Departmental Matrix
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const clientName = body.clientName || 'Etihad Rail & Logistics PJSC';
    const reportingPeriod = body.reportingPeriod || `Q3-${new Date().getFullYear()}`;

    const trips: EsgTripInput[] = Array.isArray(body.trips) && body.trips.length > 0
      ? body.trips
      : [
          {
            tripId: 'TRIP-ESG-001',
            category: 'CATEGORY_7_EMPLOYEE_COMMUTE',
            date: '2026-08-01',
            origin: 'Al Falah, Abu Dhabi',
            destination: 'Khalifa Port Industrial Zone',
            distanceKm: 42.5,
            passengerCount: 46,
            fuelType: 'DIESEL',
            vehicleCapacity: 50,
            departmentName: 'Port Operations',
          },
          {
            tripId: 'TRIP-ESG-002',
            category: 'CATEGORY_7_EMPLOYEE_COMMUTE',
            date: '2026-08-02',
            origin: 'Mohamed Bin Zayed City',
            destination: 'ICAD Industrial Zone',
            distanceKm: 28.0,
            passengerCount: 30,
            fuelType: 'EV',
            vehicleCapacity: 30,
            departmentName: 'Manufacturing & Fab',
          },
          {
            tripId: 'TRIP-ESG-003',
            category: 'CATEGORY_7_EMPLOYEE_COMMUTE',
            date: '2026-08-03',
            origin: 'Al Ain Central',
            destination: 'Tawam Hospital Campus',
            distanceKm: 18.5,
            passengerCount: 24,
            fuelType: 'HYBRID',
            vehicleCapacity: 30,
            departmentName: 'Clinical Services',
          },
          {
            tripId: 'TRIP-ESG-004',
            category: 'CATEGORY_4_UPSTREAM_FREIGHT',
            date: '2026-08-04',
            origin: 'Jebel Ali Free Zone',
            destination: 'Mussafah Heavy Terminal',
            distanceKm: 110.0,
            cargoWeightTonnes: 18.5,
            fuelType: 'DIESEL',
            vehicleCapacity: 25,
            departmentName: 'Supply Chain Logistics',
          },
        ];

    const certificate = generateScope3AuditCertificate(clientName, reportingPeriod, trips);

    return NextResponse.json({
      success: true,
      auditCertificate: certificate,
    });
  } catch (err: any) {
    console.error('Error generating Scope 3 ESG report:', err);
    return NextResponse.json({ error: 'Failed to generate Scope 3 ESG report', details: err.message }, { status: 500 });
  }
}

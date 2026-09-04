import { prisma } from '@/lib/prisma';

export interface DamageReport {
  id: string;
  tenantId: string;
  lesseeId: string;
  contractId: string;
  vehicleRef: string | null;
  severity: 'MINOR' | 'MODERATE' | 'SEVERE';
  description: string;
  photoUrls: string[];
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'RESOLVED';
  reportedBy: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  lessee_id: string;
  contract_id: string;
  vehicle_ref: string | null;
  severity: string;
  description: string;
  photo_urls: unknown;
  status: string;
  reported_by: string;
  created_at: string;
  updated_at: string;
}

const SELECT = `id::text, tenant_id, lessee_id, contract_id, vehicle_ref, severity,
  description, photo_urls, status, reported_by, created_at::text, updated_at::text`;

function rowToApi(r: Row): DamageReport {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    lesseeId: r.lessee_id,
    contractId: r.contract_id,
    vehicleRef: r.vehicle_ref,
    severity: r.severity as DamageReport['severity'],
    description: r.description,
    photoUrls: Array.isArray(r.photo_urls) ? (r.photo_urls as string[]) : [],
    status: r.status as DamageReport['status'],
    reportedBy: r.reported_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createDamageReport(args: {
  tenantId: string;
  lesseeId: string;
  contractId: string;
  vehicleRef?: string | null;
  severity: 'MINOR' | 'MODERATE' | 'SEVERE';
  description: string;
  photoUrls: string[];
  reportedBy: string;
}): Promise<DamageReport> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `INSERT INTO lease_damage_reports
       (tenant_id, lessee_id, contract_id, vehicle_ref, severity, description, photo_urls, reported_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING ${SELECT}`,
    args.tenantId, args.lesseeId, args.contractId, args.vehicleRef ?? null,
    args.severity, args.description, JSON.stringify(args.photoUrls), args.reportedBy,
  );
  if (!rows[0]) throw new Error('createDamageReport returned no row');
  return rowToApi(rows[0]);
}

export async function listDamageReportsForLessee(tenantId: string, lesseeId: string): Promise<DamageReport[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM lease_damage_reports
      WHERE tenant_id = $1 AND lessee_id = $2
      ORDER BY created_at DESC`,
    tenantId, lesseeId,
  );
  return rows.map(rowToApi);
}

export async function listDamageReportsForTenant(tenantId: string, status?: string): Promise<DamageReport[]> {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM lease_damage_reports
      WHERE tenant_id = $1 ${status ? 'AND status = $2' : ''}
      ORDER BY created_at DESC`,
    ...(status ? [tenantId, status] : [tenantId]),
  );
  return rows.map(rowToApi);
}

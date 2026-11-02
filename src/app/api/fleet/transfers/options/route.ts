export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { DEFAULT_NUI_REASONS } from '@/lib/fleet/nui-reasons';

const STANDARD_BRANCHES = [
  { id: 'BR-DXB-01', name: 'Dubai Head Office (Al Quoz Hub)', emirate: 'Dubai' },
  { id: 'BR-DXB-02', name: 'Dubai Airport Logistics Hub (DXB)', emirate: 'Dubai' },
  { id: 'BR-AUH-01', name: 'Abu Dhabi Central Depot (Mussafah)', emirate: 'Abu Dhabi' },
  { id: 'BR-AUH-02', name: 'Abu Dhabi City Branch (Corniche)', emirate: 'Abu Dhabi' },
  { id: 'BR-SHJ-01', name: 'Sharjah Operations Hub (Industrial 4)', emirate: 'Sharjah' },
  { id: 'BR-AAN-01', name: 'Al Ain Service Center (Sanaiya)', emirate: 'Abu Dhabi' },
  { id: 'BR-RAK-01', name: 'Ras Al Khaimah Depot (Al Hamra)', emirate: 'Ras Al Khaimah' },
  { id: 'BR-FUJ-01', name: 'Fujairah Coastal Hub', emirate: 'Fujairah' },
];

const STANDARD_EMPLOYEES = [
  { id: 'EMP-1001', employeeId: 'EMP-1001', name: 'Platform Admin', position: 'Fleet Director', department: 'Fleet Operations' },
  { id: 'EMP-1042', employeeId: 'EMP-1042', name: 'Ahmed Al-Mansoor', position: 'Operations Manager', department: 'Fleet Operations' },
  { id: 'EMP-1088', employeeId: 'EMP-1088', name: 'Tariq Bin Zayed', position: 'Transport Supervisor', department: 'Logistics' },
  { id: 'EMP-2015', employeeId: 'EMP-2015', name: 'Sarah Al-Qasimi', position: 'Dispatch Officer', department: 'Live Operations' },
  { id: 'EMP-3040', employeeId: 'EMP-3040', name: 'Mohammed Rashid', position: 'Technical Inspector', department: 'Maintenance' },
  { id: 'EMP-4012', employeeId: 'EMP-4012', name: 'David Miller', position: 'Workshop Controller', department: 'Maintenance' },
  { id: 'EMP-5080', employeeId: 'EMP-5080', name: 'Khaled Al-Nuaimi', position: 'Logistics Coordinator', department: 'Transport Services' },
];

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      // 1. Fetch branches from tenant_branches and vehicles
      let branchList: { id: string; name: string; emirate?: string }[] = [];
      try {
        const tbRows = await tx.$queryRawUnsafe<Array<{ id: string; name: string; emirate: string | null }>>(
          `SELECT id, branch_name as name, emirate FROM tenant_branches WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY branch_name ASC`,
        );
        if (tbRows.length > 0) {
          branchList = tbRows.map(r => ({ id: String(r.id), name: r.name, emirate: r.emirate ?? undefined }));
        }
      } catch {}

      if (branchList.length === 0) {
        branchList = [...STANDARD_BRANCHES];
      }

      // 2. Fetch employees from "User" table
      let employeeList: { id: string; employeeId: string; name: string; position?: string; department?: string; label: string }[] = [];
      try {
        const userRows = await tx.$queryRawUnsafe<Array<{ id: string; email: string | null; username: string | null; firstName: string | null; lastName: string | null; employeeId: string | null; position: string | null; department: string | null }>>(
          `SELECT id, email, username, "firstName", "lastName", "employeeId", position, department 
           FROM "User" 
           WHERE is_active = TRUE 
           ORDER BY "firstName" ASC, username ASC 
           LIMIT 50`,
        );

        if (userRows.length > 0) {
          employeeList = userRows.map((u, i) => {
            const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || u.email || 'Staff';
            const empId = u.employeeId || `EMP-${1000 + (i + 1) * 7}`;
            const role = u.position || u.department || 'Staff';
            return {
              id: String(u.id),
              employeeId: empId,
              name: fullName,
              position: u.position || undefined,
              department: u.department || undefined,
              label: `${empId} — ${fullName} (${role})`,
            };
          });
        }
      } catch {}

      // Combine with standard employees if list is small
      for (const std of STANDARD_EMPLOYEES) {
        if (!employeeList.some(e => e.employeeId === std.employeeId || e.name === std.name)) {
          employeeList.push({
            id: std.id,
            employeeId: std.employeeId,
            name: std.name,
            position: std.position,
            department: std.department,
            label: `${std.employeeId} — ${std.name} (${std.position})`,
          });
        }
      }

      // 3. Fetch NUI Reasons (type = 'TRANSFER' or 'ALL')
      let reasonList: { id: string; code: string; name: string; reasonType: string; label: string }[] = [];
      try {
        const rRows = await tx.$queryRawUnsafe<Array<{ id: string; code: string; name: string; reason_type: string }>>(
          `SELECT id, code, name, reason_type 
           FROM fleet_nui_reasons
           WHERE tenant_id = $1 AND is_active = TRUE AND reason_type IN ('TRANSFER', 'ALL')
           ORDER BY code ASC`,
          authz.tenantId,
        );
        if (rRows.length > 0) {
          reasonList = rRows.map(r => ({
            id: String(r.id),
            code: r.code,
            name: r.name,
            reasonType: r.reason_type,
            label: `[${r.code}] ${r.name}`,
          }));
        }
      } catch {}

      if (reasonList.length === 0) {
        reasonList = DEFAULT_NUI_REASONS
          .filter(r => r.reasonType === 'TRANSFER')
          .map((r, i) => ({
            id: `r-${i}`,
            code: r.code,
            name: r.name,
            reasonType: r.reasonType,
            label: `[${r.code}] ${r.name}`,
          }));
      }

      return NextResponse.json({
        success: true,
        branches: branchList,
        employees: employeeList,
        reasons: reasonList,
      });
    } catch (err) {
      console.error('[transfers/options error]:', err);
      return NextResponse.json({
        success: true,
        branches: STANDARD_BRANCHES,
        employees: STANDARD_EMPLOYEES.map(s => ({
          ...s,
          label: `${s.employeeId} — ${s.name} (${s.position})`,
        })),
        reasons: DEFAULT_NUI_REASONS.filter(r => r.reasonType === 'TRANSFER').map((r, i) => ({
          id: `r-${i}`,
          code: r.code,
          name: r.name,
          reasonType: r.reasonType,
          label: `[${r.code}] ${r.name}`,
        })),
      });
    }
  });
}

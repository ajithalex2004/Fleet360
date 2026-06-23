import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-policy';
import { executeLeasingApproval } from '@/lib/leasing-approval-executor';
import { executeAdminApprovalAction } from '@/lib/admin-approval-executor';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdminPermission(req, 'create', 'audit');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const generic = await executeAdminApprovalAction(req, auth.ctx, id);
  if (generic) return generic;
  return executeLeasingApproval(req, auth.ctx, id);
}

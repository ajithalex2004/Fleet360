export const dynamic = 'force-dynamic';

/**
 * Module availability policies (Admin > Module Policies).
 *
 *   GET  /api/admin/module-policies  policies for every module plus the plan
 *        list (the module picker in Create Tenant / Manage reads it)
 *   PUT  /api/admin/module-policies  { "<moduleKey>": { availability, minPlan? } }
 *        platform admin
 *
 * Rules: src/lib/module-policy-rules.ts. Storage: src/lib/module-policies.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { getModulePolicies, saveModulePolicies } from '@/lib/module-policies';
import { listPlans } from '@/lib/plans';

async function plansForUi() {
  return (await listPlans({ activeOnly: true })).map((p) => ({ code: p.code, name: p.name, sortOrder: p.sortOrder }));
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  try {
    const [policies, plans] = await Promise.all([getModulePolicies(), plansForUi()]);
    return NextResponse.json({ policies, plans }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[module-policies GET]', e);
    return NextResponse.json({ error: 'Failed to load module policies' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? stripTenantOwnershipFields(raw) : raw;
  try {
    const saved = await saveModulePolicies(body);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
    return NextResponse.json({ policies: saved.policies, plans: await plansForUi() });
  } catch (e) {
    console.error('[module-policies PUT]', e);
    return NextResponse.json({ error: 'Failed to save module policies' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);

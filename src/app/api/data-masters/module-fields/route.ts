/**
 * GET /api/data-masters/module-fields?module=MAINTENANCE
 *
 * Returns the curated catalogue of bindable fields for a LinkedModule.
 * The Form Fields tab reads this to populate its module-aware bind-to
 * dropdown and the "Sync from module catalog" picker.
 *
 * Why an endpoint when the catalogue is plain TypeScript? Two reasons:
 *   • Lets us swap to a tenant-customised registry later (e.g. some
 *     tenants add custom modules with their own fields) without
 *     rewriting every consumer.
 *   • Keeps the catalogue out of the client bundle when it's not needed
 *     (Next.js code-splitting won't ship the registry for users who
 *     never open the Form Fields tab).
 *
 * Without the `?module=…` parameter, returns the full registry keyed
 * by LinkedModule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { LINKED_MODULES, type LinkedModule } from '@/types/service-config';
import { getModuleFields, MODULE_FIELD_CATALOG } from '@/lib/service-config/module-fields';

export async function GET(req: NextRequest) {
  try {
    const moduleParam = req.nextUrl.searchParams.get('module');
    if (moduleParam) {
      if (!(LINKED_MODULES as readonly string[]).includes(moduleParam)) {
        return NextResponse.json({ error: `Unknown module ${moduleParam}` }, { status: 400 });
      }
      const fields = getModuleFields(moduleParam as LinkedModule);
      return NextResponse.json(
        { module: moduleParam, fields },
        { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } },
      );
    }
    // Full registry — useful for the "all modules" admin view (rare).
    return NextResponse.json(
      { catalog: MODULE_FIELD_CATALOG },
      { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' } },
    );
  } catch (e) {
    console.error('[module-fields] GET error:', e);
    return NextResponse.json({ error: 'Failed to load module fields' }, { status: 500 });
  }
}

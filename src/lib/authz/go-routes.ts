/**
 * Every route the Go backend serves under /api/v1, written as the /api/…
 * path the policy decides, with sample ids ({tenant} = the caller's
 * tenant). Used by the Go policy vectors (tests/unit/authz-go-policy.test.ts)
 * and the security harness plan (scripts/security-harness/plan.json).
 * Only routes Go registers: Gin answers anything else 404 before its
 * middleware runs. Keep in step with the route registrations in
 * backend/main.go.
 */
export const GO_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['GET', '/api/fleet/vehicles'], ['GET', '/api/fleet/vehicles/v1'], ['POST', '/api/fleet/vehicles'],
  ['PATCH', '/api/fleet/vehicles/v1'], ['DELETE', '/api/fleet/vehicles/v1'],
  ['GET', '/api/fleet/drivers'], ['GET', '/api/fleet/drivers/d1'],
  ['GET', '/api/fleet/garages'], ['POST', '/api/fleet/garages'], ['PUT', '/api/fleet/garages/g1'],
  ['GET', '/api/maintenance/requests'], ['GET', '/api/maintenance/requests/m1'], ['POST', '/api/maintenance/requests'],
  ['PATCH', '/api/maintenance/requests/m1'], ['GET', '/api/maintenance/predictive'],
  ['GET', '/api/service/requests'], ['POST', '/api/service/requests'], ['PATCH', '/api/service/requests/s1'],
  ['POST', '/api/quotations'], ['PUT', '/api/quotations/q1'], ['PATCH', '/api/quotations/q1'],
  ['POST', '/api/alerts'], ['GET', '/api/alerts/configs'], ['POST', '/api/alerts/configs'],
  ['PATCH', '/api/alerts/configs/c1'], ['DELETE', '/api/alerts/configs/c1'],
  ['POST', '/api/files/upload'], ['GET', '/api/files/sign'], ['DELETE', '/api/files'],
  ['GET', '/api/logistics/shipments'], ['GET', '/api/logistics/shipments/s1'], ['POST', '/api/logistics/shipments'],
  ['GET', '/api/logistics/stats'], ['GET', '/api/logistics/analytics'], ['GET', '/api/logistics/sla'],
  ['GET', '/api/logistics/carriers'], ['POST', '/api/logistics/carriers'], ['POST', '/api/logistics/rate-contracts'],
  ['POST', '/api/logistics/rates/quote'], ['GET', '/api/logistics/rfqs'], ['POST', '/api/logistics/bids'],
  ['POST', '/api/logistics/shipments/s1/tracking'], ['GET', '/api/logistics/finance/reconciliation'],
  ['POST', '/api/logistics/planner/optimize'], ['POST', '/api/logistics/planner/plans/p1/commit'],
  ['POST', '/api/admin/tenants'], ['GET', `/api/admin/tenants/{tenant}`], ['PATCH', `/api/admin/tenants/{tenant}`],
  ['POST', `/api/admin/tenants/{tenant}/suspend`], ['POST', `/api/admin/tenants/{tenant}/offboard`],
  ['GET', `/api/admin/tenants/{tenant}/audit`], ['GET', `/api/admin/tenants/{tenant}/plan`],
  ['POST', `/api/admin/tenants/{tenant}/invitations`], ['POST', '/api/admin/audit/verify'],
  ['GET', '/api/dispatch/trips'], ['POST', '/api/dispatch/trips'], ['DELETE', '/api/dispatch/trips/t1'],
  ['GET', '/api/dispatch/incidents'], ['POST', '/api/dispatch/incidents'],
  ['GET', '/api/dispatch/ambulance-calls'], ['POST', '/api/dispatch/ambulance-calls'], ['PATCH', '/api/dispatch/ambulance-calls/a1'],
  ['GET', '/api/dispatch/routes'], ['GET', '/api/dispatch/trips/t1/passengers'],
];

/**
 * clear-all-routes.ts
 *
 * Permanently deletes ALL bus-ops route data from the database.
 * Deletes in FK-safe dependency order (children before parents).
 *
 * Run with:
 *   npx tsx scripts/clear-all-routes.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('⚠️  This will permanently delete ALL route data.\n');

  // --- Count before ---
  const routeCount = await prisma.busRoute.count();
  console.log(`Routes found: ${routeCount}`);
  if (routeCount === 0) {
    console.log('Nothing to delete.');
    return;
  }

  console.log('\nDeleting in dependency order…\n');

  // 1. Trip-level children
  const tripStopVisits = await prisma.tripStopVisit.deleteMany({});
  console.log(`  trip_stop_visits              deleted: ${tripStopVisits.count}`);

  const tripPassengers = await prisma.tripPassenger.deleteMany({});
  console.log(`  trip_passengers               deleted: ${tripPassengers.count}`);

  const tripLogs = await prisma.tripLog.deleteMany({});
  console.log(`  trip_logs                     deleted: ${tripLogs.count}`);

  const tripSchedules = await prisma.tripSchedule.deleteMany({});
  console.log(`  trip_schedules                deleted: ${tripSchedules.count}`);

  // 2. Route-level children (flat stops + headway rules)
  const routeStops = await prisma.routeStop.deleteMany({});
  console.log(`  route_stops                   deleted: ${routeStops.count}`);

  const headwayRules = await prisma.headwayRule.deleteMany({});
  console.log(`  headway_rules                 deleted: ${headwayRules.count}`);

  // 3. Consolidation log children (must precede RouteConsolidation + RoutePassenger)
  const enrollmentMigrations =
    await prisma.routeConsolidationEnrollmentMigration.deleteMany({});
  console.log(`  route_consolidation_enrollment_migrations deleted: ${enrollmentMigrations.count}`);

  const consolidationSources =
    await prisma.routeConsolidationSource.deleteMany({});
  console.log(`  route_consolidation_sources   deleted: ${consolidationSources.count}`);

  const consolidations = await prisma.routeConsolidation.deleteMany({});
  console.log(`  route_consolidations          deleted: ${consolidations.count}`);

  // 4. Route passengers roster
  const routePassengers = await prisma.routePassenger.deleteMany({});
  console.log(`  route_passengers              deleted: ${routePassengers.count}`);

  // 5. Schedule templates
  const scheduleTemplates = await prisma.busOpsScheduleTemplate.deleteMany({});
  console.log(`  bus_ops_schedule_templates    deleted: ${scheduleTemplates.count}`);

  // 6. Route versioning hierarchy (versions → variants)
  const variantVersions = await prisma.busRouteVariantVersion.deleteMany({});
  console.log(`  bus_route_variant_versions    deleted: ${variantVersions.count}`);

  const variants = await prisma.busRouteVariant.deleteMany({});
  console.log(`  bus_route_variants            deleted: ${variants.count}`);

  // 7. Routes (root)
  const routes = await prisma.busRoute.deleteMany({});
  console.log(`  bus_routes                    deleted: ${routes.count}`);

  console.log(`\n✅ Done — ${routes.count} routes and all related data removed.`);
}

main()
  .catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

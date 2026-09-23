/**
 * Maps a booking serviceType to its owning module route segment.
 * Split out of src/app/booking-portal/page.tsx so tests can import it
 * directly -- Next.js page.tsx files may only export the default
 * component and a small set of reserved names (metadata, dynamic, ...).
 */
export const SERVICE_MODULE_MAP: Record<string, string> = {
  RENTAL:          'rental',
  LEASING:         'leasing',
  STAFF_TRANSPORT: 'bus-ops',
  EXECUTIVE:       'dispatch',
  LOGISTICS:       'logistics',
  SCHOOL_BUS:      'school-bus',
};

/**
 * Driver-reported issues. A report becomes a corrective maintenance
 * request (so the workshop sees it in the normal queue); its description
 * starts with a fixed prefix so the Driver Feedback screen can list the
 * reports back and show their category and severity.
 */

export const DRIVER_REPORT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type DriverReportSeverity = (typeof DRIVER_REPORT_SEVERITIES)[number];

export const DRIVER_REPORT_CATEGORIES = ['Engine', 'Brakes', 'Transmission', 'Electrical', 'AC/Heating', 'Tyres', 'Body', 'Other'] as const;

const PREFIX = 'Driver report';
const PATTERN = /^Driver report — (.+?) \((Low|Medium|High|Critical)\): ([\s\S]*)$/;

export interface DriverReportForm {
  vehicleId: string;
  issue: string;
  severity: DriverReportSeverity;
  category: string;
}

/** The maintenance-request body for a report, or an error to show. */
export function driverReportRequest(f: DriverReportForm):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const issue = f.issue.trim();
  if (!f.vehicleId) return { ok: false, error: 'Choose the vehicle' };
  if (!issue) return { ok: false, error: 'Describe the issue' };
  if (!(DRIVER_REPORT_SEVERITIES as readonly string[]).includes(f.severity)) return { ok: false, error: 'Choose a severity' };
  const category = f.category.trim() || 'Other';
  return {
    ok: true,
    body: {
      vehicleId: f.vehicleId,
      description: `${PREFIX} — ${category} (${f.severity}): ${issue.slice(0, 2000)}`,
      maintenanceType: 'CORRECTIVE',
      priority: f.severity.toUpperCase(),
      status: 'Requested',
      maintenanceJobs: [category],
    },
  };
}

/** Category, severity and text of a request made from a driver report; null for other requests. */
export function parseDriverReport(description: string | null | undefined):
  { category: string; severity: DriverReportSeverity; issue: string } | null {
  const m = description ? PATTERN.exec(description) : null;
  return m ? { category: m[1], severity: m[2] as DriverReportSeverity, issue: m[3] } : null;
}

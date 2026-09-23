'use server';

import { sendWorkOrderEmail, sendDriverAssignmentEmail } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendWorkOrderEmailAction(
  request: EnhancedMaintenanceRequest,
  garageName: string,
  garageEmail: string
) {
  return await sendWorkOrderEmail(request, garageName, garageEmail);
}

export async function sendDriverAssignmentEmailAction(
  request: EnhancedMaintenanceRequest,
  driverName: string,
  driverEmail: string,
  garageName: string
) {
  return await sendDriverAssignmentEmail(request, driverName, driverEmail, garageName);
}

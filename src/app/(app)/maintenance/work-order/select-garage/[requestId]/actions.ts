'use server';

import { sendWorkOrderEmail, sendDriverAssignmentEmail } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendWorkOrderEmailAction(
  request: EnhancedMaintenanceRequest,
  garageEmail: string
) {
  return await sendWorkOrderEmail(request, garageEmail);
}

export async function sendDriverAssignmentEmailAction(
  request: EnhancedMaintenanceRequest,
  driverEmail: string
) {
  return await sendDriverAssignmentEmail(request, driverEmail);
}

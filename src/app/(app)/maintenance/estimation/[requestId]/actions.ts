'use server';

import { sendRFQEmail } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendRFQEmailAction(
  request: EnhancedMaintenanceRequest,
  garageEmails: string[]
) {
  return await sendRFQEmail(request, garageEmails);
}

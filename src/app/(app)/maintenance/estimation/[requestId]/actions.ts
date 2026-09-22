'use server';

import { sendRFQEmail, type EmailRecipient } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendRFQEmailAction(
  request: EnhancedMaintenanceRequest,
  garageEmails: EmailRecipient[]
) {
  return await sendRFQEmail(request, garageEmails);
}

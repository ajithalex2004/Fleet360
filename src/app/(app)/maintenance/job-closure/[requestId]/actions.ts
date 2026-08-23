'use server';

import { sendJobClosureEmail } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendJobClosureEmailAction(
  request: EnhancedMaintenanceRequest,
  recipientEmails: string[]
) {
  return await sendJobClosureEmail(request, recipientEmails);
}

'use server';

import { sendJobClosureEmail } from '@/services/email/emailService';
import type { EnhancedMaintenanceRequest } from '@/types/maintenance';

export async function sendJobClosureEmailAction(
  request: EnhancedMaintenanceRequest
) {
  // sendJobClosureEmail always notifies a fixed internal stakeholder list —
  // it takes no recipient list of its own.
  return await sendJobClosureEmail(request);
}

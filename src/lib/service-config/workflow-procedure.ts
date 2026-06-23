function toProcedureCode(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
    .toUpperCase();
  return normalized;
}

const SERVICE_TYPE_PROCEDURE_ALIASES: Record<string, string[]> = {
  LEASING_ENQUIRIES: ['ENQUIRY_REVIEW'],
  LEASING_QUOTATIONS: ['QUOTATION_APPROVAL'],
  LEASING_CREDIT_APPROVAL: ['CREDIT_APPROVAL'],
  LEASING_CONTRACT_ACTIVATION: ['CONTRACT_APPROVAL'],
  LEASING_HANDOVER: ['HANDOVER'],
  LEASING_RETURN: ['RETURN'],
  LEASING_BILLING_EXCEPTION: ['BILLING_EXCEPTION'],
  RAC_RESERVATIONS: ['BOOKING_APPROVAL'],
  RAC_QUOTATIONS: ['RATE_OVERRIDE'],
  RAC_RENTAL_AGREEMENT: ['CONTRACT_APPROVAL', 'BOOKING_APPROVAL'],
  RAC_CHECKOUT_HANDOVER: ['HANDOVER'],
  RAC_CHECKIN_RETURN: ['RETURN'],
  RAC_DAMAGE_INSPECTION: ['DAMAGE_CLAIM'],
  RAC_BILLING_EXCEPTION: ['BILLING_EXCEPTION', 'REFUND_APPROVAL'],
  STAFF_TRANSPORT_REQUEST: ['TRANSPORT_REQUEST_APPROVAL', 'ROUTE_APPROVAL'],
  STAFF_ROUTE_ASSIGNMENT: ['ROUTE_APPROVAL', 'DRIVER_ASSIGNMENT'],
  STAFF_TRIP_SCHEDULING: ['ROUTE_APPROVAL'],
  STAFF_ATTENDANCE_EXCEPTION: ['ATTENDANCE_EXCEPTION', 'INCIDENT_REPORT'],
  STAFF_BILLING_EXCEPTION: ['BILLING_EXCEPTION'],
  SCHOOL_TRANSPORT_REGISTRATION: ['STUDENT_ONBOARD'],
  SCHOOL_ROUTE_ALLOCATION: ['ROUTE_APPROVAL'],
  SCHOOL_ATTENDANCE_EXCEPTION: ['ATTENDANCE_EXCEPTION'],
  SCHOOL_SAFETY_INCIDENT_REVIEW: ['INCIDENT_REPORT'],
  SCHOOL_BILLING_EXCEPTION: ['BILLING_EXCEPTION'],
  DRIVER_ONBOARDING: ['DRIVER_ONBOARDING'],
  DRIVER_ASSIGNMENT: ['DRIVER_ASSIGNMENT'],
  DRIVER_LICENSE_RENEWAL: ['LICENSE_RENEWAL'],
  DRIVER_INCIDENT_REVIEW: ['DRIVER_VERIFICATION', 'INCIDENT_REPORT'],
  DRIVER_COMPLIANCE_EXCEPTION: ['COMPLIANCE_EXCEPTION', 'DRIVER_VERIFICATION'],
  MAINTENANCE_REQUEST_APPROVAL: ['MAINTENANCE_APPROVAL'],
  MAINTENANCE_WORK_ORDER: ['WORK_ORDER_APPROVAL'],
  MAINTENANCE_ESTIMATE_APPROVAL: ['ESTIMATE_APPROVAL'],
  MAINTENANCE_VENDOR_ASSIGNMENT: ['VENDOR_ASSIGNMENT'],
  MAINTENANCE_COMPLETION_REVIEW: ['COMPLETION_REVIEW'],
  MAINTENANCE_BILLING_EXCEPTION: ['BILLING_EXCEPTION', 'INVOICE_EXCEPTION'],
  FINANCE_BILLING_EXCEPTION: ['BILLING_EXCEPTION'],
  FINANCE_EXPENSE_EXCEPTION: ['EXPENSE_EXCEPTION'],
  FINANCE_BUDGET_EXCEPTION: ['BUDGET_EXCEPTION'],
  FINANCE_RECEIVABLE_EXCEPTION: ['RECEIVABLE_EXCEPTION'],
  ADMIN_USER_PROVISIONING: ['USER_PROVISIONING'],
  ADMIN_ROLE_PERMISSION_CHANGE: ['ROLE_PERMISSION_CHANGE'],
  ADMIN_WORKFLOW_CHANGE: ['WORKFLOW_CHANGE'],
  ADMIN_SERVICE_CONFIGURATION_CHANGE: ['SERVICE_CONFIGURATION_CHANGE'],
  ADMIN_BILLING_PLAN_CHANGE: ['BILLING_PLAN_CHANGE'],
};

const PROCEDURE_TO_SERVICE_TYPE_ALIASES: Record<string, string[]> = Object.entries(SERVICE_TYPE_PROCEDURE_ALIASES)
  .reduce<Record<string, string[]>>((acc, [serviceTypeKey, procedures]) => {
    for (const procedure of procedures) {
      const normalized = toProcedureCode(procedure);
      if (!normalized) continue;
      if (!acc[normalized]) acc[normalized] = [];
      acc[normalized].push(serviceTypeKey);
    }
    return acc;
  }, {});

export function getWorkflowProcedureCandidates(typeKey?: string | null, typeName?: string | null) {
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value?: string | null) => {
    const code = toProcedureCode(value);
    if (!code || seen.has(code)) return;
    seen.add(code);
    out.push(code);
  };

  add(typeKey);
  add(typeName);
  for (const alias of SERVICE_TYPE_PROCEDURE_ALIASES[String(typeKey ?? '').trim()] ?? []) {
    add(alias);
  }

  return out;
}

export function getPreferredWorkflowProcedure(typeKey?: string | null, typeName?: string | null) {
  const candidates = getWorkflowProcedureCandidates(typeKey, typeName);
  return candidates[1] && candidates[1] !== toProcedureCode(typeKey) ? candidates[1] : candidates[0] ?? '';
}

export function getServiceTypeKeyCandidatesForProcedure(procedure?: string | null) {
  const normalized = toProcedureCode(procedure);
  if (!normalized) return [];
  const out: string[] = [];
  const seen = new Set<string>();

  const add = (value?: string | null) => {
    const key = toProcedureCode(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  add(normalized);
  for (const alias of PROCEDURE_TO_SERVICE_TYPE_ALIASES[normalized] ?? []) {
    add(alias);
  }

  return out;
}

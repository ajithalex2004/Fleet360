// ============================================================
// PERMISSION DEFINITIONS & UTILITIES
// XL AI Smart Mobility - RBAC System
// ============================================================

export const MODULES = [
  'leasing', 'rac', 'bus_ops', 'fleet',
  'maintenance', 'finance', 'drivers',
  'compliance', 'reports', 'admin',
] as const;

export type Module = typeof MODULES[number];

export const ACTIONS = [
  'view', 'create', 'edit', 'delete', 'approve', 'export',
] as const;

export type Action = typeof ACTIONS[number];

// All granular permissions in the system
export const ALL_PERMISSIONS: { module: Module; action: Action; resource: string; label: string }[] = [
  // LEASING
  { module: 'leasing', action: 'view',    resource: '*',             label: 'View Leasing Module' },
  { module: 'leasing', action: 'create',  resource: 'inquiries',     label: 'Create Lease Inquiries' },
  { module: 'leasing', action: 'edit',    resource: 'inquiries',     label: 'Edit Lease Inquiries' },
  { module: 'leasing', action: 'delete',  resource: 'inquiries',     label: 'Delete Lease Inquiries' },
  { module: 'leasing', action: 'create',  resource: 'quotations',    label: 'Create Quotations' },
  { module: 'leasing', action: 'edit',    resource: 'quotations',    label: 'Edit Quotations' },
  { module: 'leasing', action: 'approve', resource: 'quotations',    label: 'Approve Quotations' },
  { module: 'leasing', action: 'delete',  resource: 'quotations',    label: 'Delete Quotations' },
  { module: 'leasing', action: 'create',  resource: 'contracts',     label: 'Create Lease Contracts' },
  { module: 'leasing', action: 'edit',    resource: 'contracts',     label: 'Edit Lease Contracts' },
  { module: 'leasing', action: 'approve', resource: 'contracts',     label: 'Approve Lease Contracts' },
  { module: 'leasing', action: 'delete',  resource: 'contracts',     label: 'Delete Lease Contracts' },
  { module: 'leasing', action: 'create',  resource: 'payments',      label: 'Record Lease Payments' },
  { module: 'leasing', action: 'approve', resource: 'payments',      label: 'Approve Payment Waivers' },
  { module: 'leasing', action: 'create',  resource: 'invoices',      label: 'Create Consolidated Invoices' },
  { module: 'leasing', action: 'approve', resource: 'invoices',      label: 'Approve & Send Invoices' },
  { module: 'leasing', action: 'create',  resource: 'traffic_fines', label: 'Log Traffic Fines' },
  { module: 'leasing', action: 'edit',    resource: 'traffic_fines', label: 'Update Fine Billing Status' },
  { module: 'leasing', action: 'create',  resource: 'fuel',          label: 'Log Fuel Charges' },
  { module: 'leasing', action: 'edit',    resource: 'fuel',          label: 'Update Fuel Billing Status' },
  { module: 'leasing', action: 'create',  resource: 'insurance',     label: 'Create Insurance Policies' },
  { module: 'leasing', action: 'edit',    resource: 'insurance',     label: 'Edit Insurance Policies' },
  { module: 'leasing', action: 'create',  resource: 'mileage',       label: 'Log Mileage Readings' },
  { module: 'leasing', action: 'approve', resource: 'mileage',       label: 'Approve Mileage Overage Waivers' },
  { module: 'leasing', action: 'create',  resource: 'renewals',      label: 'Propose Contract Renewals' },
  { module: 'leasing', action: 'approve', resource: 'renewals',      label: 'Approve Contract Renewals' },
  { module: 'leasing', action: 'create',  resource: 'terminations',  label: 'Request Early Termination' },
  { module: 'leasing', action: 'approve', resource: 'terminations',  label: 'Approve Early Termination' },
  { module: 'leasing', action: 'create',  resource: 'remarketing',   label: 'Add Vehicles to Remarketing' },
  { module: 'leasing', action: 'edit',    resource: 'remarketing',   label: 'Update Remarketing Stage' },
  { module: 'leasing', action: 'approve', resource: 'remarketing',   label: 'Approve Vehicle Sale' },
  { module: 'leasing', action: 'view',    resource: 'receivables',   label: 'View AR Aging Report' },
  { module: 'leasing', action: 'create',  resource: 'dunning',       label: 'Log Dunning Activities' },
  { module: 'leasing', action: 'create',  resource: 'credit',        label: 'Create Credit Assessments' },
  { module: 'leasing', action: 'approve', resource: 'credit',        label: 'Approve Credit Limits' },
  { module: 'leasing', action: 'create',  resource: 'documents',     label: 'Upload Documents' },
  { module: 'leasing', action: 'delete',  resource: 'documents',     label: 'Delete Documents' },
  { module: 'leasing', action: 'export',  resource: '*',             label: 'Export Leasing Data' },

  // RAC
  { module: 'rac', action: 'view',    resource: '*',          label: 'View RAC Module' },
  { module: 'rac', action: 'create',  resource: 'bookings',   label: 'Create RAC Bookings' },
  { module: 'rac', action: 'edit',    resource: 'bookings',   label: 'Edit RAC Bookings' },
  { module: 'rac', action: 'approve', resource: 'bookings',   label: 'Confirm/Activate Bookings' },
  { module: 'rac', action: 'delete',  resource: 'bookings',   label: 'Cancel Bookings' },
  { module: 'rac', action: 'create',  resource: 'customers',  label: 'Add RAC Customers' },
  { module: 'rac', action: 'edit',    resource: 'customers',  label: 'Edit RAC Customers' },
  { module: 'rac', action: 'create',  resource: 'damage',     label: 'Log Damage Claims' },
  { module: 'rac', action: 'approve', resource: 'damage',     label: 'Close Damage Claims' },
  { module: 'rac', action: 'edit',    resource: 'pricing',    label: 'Manage Pricing Rules' },
  { module: 'rac', action: 'export',  resource: '*',          label: 'Export RAC Data' },

  // BUS OPS
  { module: 'bus_ops', action: 'view',    resource: '*',        label: 'View Staff Transport Module' },
  { module: 'bus_ops', action: 'create',  resource: 'routes',   label: 'Create Bus Routes' },
  { module: 'bus_ops', action: 'edit',    resource: 'routes',   label: 'Edit Bus Routes' },
  { module: 'bus_ops', action: 'delete',  resource: 'routes',   label: 'Delete Bus Routes' },
  { module: 'bus_ops', action: 'create',  resource: 'trips',    label: 'Schedule Trips' },
  { module: 'bus_ops', action: 'approve', resource: 'trips',    label: 'Depart / Complete Trips' },
  { module: 'bus_ops', action: 'create',  resource: 'staff',    label: 'Register Staff' },
  { module: 'bus_ops', action: 'edit',    resource: 'staff',    label: 'Edit Staff Records' },
  { module: 'bus_ops', action: 'create',  resource: 'incidents','label': 'Log Incidents' },
  { module: 'bus_ops', action: 'approve', resource: 'incidents', label: 'Resolve Incidents' },
  { module: 'bus_ops', action: 'export',  resource: '*',        label: 'Export Transport Data' },

  // FLEET
  { module: 'fleet', action: 'view',    resource: '*',       label: 'View Fleet Module' },
  { module: 'fleet', action: 'create',  resource: 'vehicles', label: 'Add Vehicles' },
  { module: 'fleet', action: 'edit',    resource: 'vehicles', label: 'Edit Vehicles' },
  { module: 'fleet', action: 'delete',  resource: 'vehicles', label: 'Retire Vehicles' },
  { module: 'fleet', action: 'create',  resource: 'documents', label: 'Upload Fleet Documents' },
  { module: 'fleet', action: 'export',  resource: '*',        label: 'Export Fleet Data' },

  // MAINTENANCE
  { module: 'maintenance', action: 'view',    resource: '*',          label: 'View Maintenance Module' },
  { module: 'maintenance', action: 'create',  resource: 'requests',   label: 'Create Service Requests' },
  { module: 'maintenance', action: 'edit',    resource: 'requests',   label: 'Edit Service Requests' },
  { module: 'maintenance', action: 'approve', resource: 'requests',   label: 'Approve Service Requests' },
  { module: 'maintenance', action: 'create',  resource: 'work_orders', label: 'Create Work Orders' },
  { module: 'maintenance', action: 'approve', resource: 'work_orders', label: 'Close Work Orders' },
  { module: 'maintenance', action: 'export',  resource: '*',          label: 'Export Maintenance Data' },

  // FINANCE
  { module: 'finance', action: 'view',    resource: '*',       label: 'View Finance Module' },
  { module: 'finance', action: 'create',  resource: 'invoices', label: 'Create Finance Invoices' },
  { module: 'finance', action: 'approve', resource: 'invoices', label: 'Approve Finance Invoices' },
  { module: 'finance', action: 'view',    resource: 'reports',  label: 'View Financial Reports' },
  { module: 'finance', action: 'export',  resource: '*',        label: 'Export Finance Data' },

  // DRIVERS
  { module: 'drivers', action: 'view',    resource: '*',         label: 'View Drivers Module' },
  { module: 'drivers', action: 'create',  resource: 'profiles',  label: 'Add Driver Profiles' },
  { module: 'drivers', action: 'edit',    resource: 'profiles',  label: 'Edit Driver Profiles' },
  { module: 'drivers', action: 'delete',  resource: 'profiles',  label: 'Deactivate Drivers' },
  { module: 'drivers', action: 'export',  resource: '*',         label: 'Export Driver Data' },

  // COMPLIANCE
  { module: 'compliance', action: 'view',    resource: '*',      label: 'View Compliance Module' },
  { module: 'compliance', action: 'create',  resource: '*',      label: 'Add Compliance Records' },
  { module: 'compliance', action: 'approve', resource: '*',      label: 'Approve Compliance Items' },
  { module: 'compliance', action: 'export',  resource: '*',      label: 'Export Compliance Data' },

  // REPORTS
  { module: 'reports', action: 'view',   resource: '*', label: 'View Reports' },
  { module: 'reports', action: 'export', resource: '*', label: 'Export Reports' },

  // ADMIN
  { module: 'admin', action: 'view',   resource: 'tenants',     label: 'View Tenants' },
  { module: 'admin', action: 'create', resource: 'tenants',     label: 'Create Tenants' },
  { module: 'admin', action: 'edit',   resource: 'tenants',     label: 'Edit Tenants' },
  { module: 'admin', action: 'delete', resource: 'tenants',     label: 'Delete Tenants' },
  { module: 'admin', action: 'view',   resource: 'users',       label: 'View All Users' },
  { module: 'admin', action: 'create', resource: 'users',       label: 'Create Users' },
  { module: 'admin', action: 'edit',   resource: 'users',       label: 'Edit Users' },
  { module: 'admin', action: 'delete', resource: 'users',       label: 'Deactivate Users' },
  { module: 'admin', action: 'view',   resource: 'roles',       label: 'View Roles' },
  { module: 'admin', action: 'create', resource: 'roles',       label: 'Create Roles' },
  { module: 'admin', action: 'edit',   resource: 'roles',       label: 'Edit Role Permissions' },
  { module: 'admin', action: 'delete', resource: 'roles',       label: 'Delete Roles' },
];

// Helper: all modules view only permissions
const ALL_MODULES_VIEW_ONLY = MODULES.map(m => ({ module: m as string, action: 'view', resource: '*' }));

// System roles with their default permissions
export const SYSTEM_ROLES: {
  code: string;
  name: string;
  description: string;
  permissions: { module: string; action: string; resource: string }[];
}[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full platform access - all tenants, all modules, all actions',
    permissions: ALL_PERMISSIONS.map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'TENANT_ADMIN',
    name: 'Tenant Administrator',
    description: 'Full access within their tenant - all modules except platform admin',
    permissions: ALL_PERMISSIONS.filter(p => p.module !== 'admin').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'LEASING_MANAGER',
    name: 'Leasing Manager',
    description: 'Full leasing + finance view + reports',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'leasing').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'finance', action: 'view', resource: '*' },
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
    ],
  },
  {
    code: 'LEASING_OPERATOR',
    name: 'Leasing Operator',
    description: 'Create and edit leasing records, no approve or delete',
    permissions: ALL_PERMISSIONS.filter(p => p.module === 'leasing' && ['view','create','edit'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'RAC_MANAGER',
    name: 'RAC Manager',
    description: 'Full Rent-a-Car module access',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'rac').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'reports', action: 'view', resource: '*' },
    ],
  },
  {
    code: 'RAC_OPERATOR',
    name: 'RAC Operator',
    description: 'Create and edit RAC records, no approve or delete',
    permissions: ALL_PERMISSIONS.filter(p => p.module === 'rac' && ['view','create','edit'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'TRANSPORT_MANAGER',
    name: 'Transport Manager',
    description: 'Full staff transportation module access',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'bus_ops').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'reports', action: 'view', resource: '*' },
    ],
  },
  {
    code: 'TRANSPORT_OPERATOR',
    name: 'Transport Operator',
    description: 'Create and edit transport records, can depart/complete trips',
    permissions: ALL_PERMISSIONS.filter(p => p.module === 'bus_ops' && ['view','create','edit','approve'].includes(p.action)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
  {
    code: 'FLEET_MANAGER',
    name: 'Fleet Manager',
    description: 'Fleet + Maintenance + Drivers full access',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => ['fleet','maintenance','drivers'].includes(p.module)).map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
    ],
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    description: 'Finance full access + view all modules + export',
    permissions: [
      ...ALL_PERMISSIONS.filter(p => p.module === 'finance').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
      ...ALL_MODULES_VIEW_ONLY,
      { module: 'reports', action: 'view', resource: '*' },
      { module: 'reports', action: 'export', resource: '*' },
      { module: 'leasing', action: 'view', resource: 'receivables' },
      { module: 'leasing', action: 'export', resource: '*' },
    ],
  },
  {
    code: 'VIEWER',
    name: 'Read-Only Viewer',
    description: 'View-only access to all modules, no create/edit/delete/approve',
    permissions: ALL_PERMISSIONS.filter(p => p.action === 'view').map(p => ({ module: p.module, action: p.action, resource: p.resource })),
  },
];



// --- CLIENT-SIDE PERMISSION HELPERS ----------------------------------------

export type UserPermission = `${string}:${string}:${string}`;

export function buildPermissionKey(module: string, action: string, resource = '*'): UserPermission {
  return `${module}:${action}:${resource}`;
}

export function hasPermission(
  userPermissions: string[],
  module: string,
  action: string,
  resource = '*'
): boolean {
  if (!userPermissions || userPermissions.length === 0) return false;
  // Super admin shortcut
  if (userPermissions.includes('*:*:*')) return true;
  // Exact match
  if (userPermissions.includes(`${module}:${action}:${resource}`)) return true;
  // Wildcard resource match (module:action:* covers module:action:specific)
  if (userPermissions.includes(`${module}:${action}:*`)) return true;
  // Module-level wildcard
  if (userPermissions.includes(`${module}:*:*`)) return true;
  return false;
}

export function canView(perms: string[], module: string)   { return hasPermission(perms, module, 'view'); }
export function canCreate(perms: string[], module: string, resource = '*') { return hasPermission(perms, module, 'create', resource); }
export function canEdit(perms: string[], module: string, resource = '*')   { return hasPermission(perms, module, 'edit', resource); }
export function canDelete(perms: string[], module: string, resource = '*') { return hasPermission(perms, module, 'delete', resource); }
export function canApprove(perms: string[], module: string, resource = '*'){ return hasPermission(perms, module, 'approve', resource); }
export function canExport(perms: string[], module: string)  { return hasPermission(perms, module, 'export'); }

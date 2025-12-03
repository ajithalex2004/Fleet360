import { UserRole } from '@/types/maintenance';

// Permission definitions
export enum Permission {
    SUBMIT_REQUEST = 'SUBMIT_REQUEST',
    ACKNOWLEDGE_REQUEST = 'ACKNOWLEDGE_REQUEST',
    APPROVE_REQUEST = 'APPROVE_REQUEST',
    REJECT_REQUEST = 'REJECT_REQUEST',
    SEND_RFQ = 'SEND_RFQ',
    ENTER_QUOTATION = 'ENTER_QUOTATION',
    APPROVE_ESTIMATE = 'APPROVE_ESTIMATE',
    REJECT_ESTIMATE = 'REJECT_ESTIMATE',
    COMPLETE_MAINTENANCE = 'COMPLETE_MAINTENANCE',
    ENTER_COSTS = 'ENTER_COSTS',
    CLOSE_JOB = 'CLOSE_JOB',
    VIEW_ALL_REQUESTS = 'VIEW_ALL_REQUESTS',
}

// Role-Permission mapping
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
    [UserRole.DRIVER]: [
        Permission.SUBMIT_REQUEST,
    ],
    [UserRole.OPERATIONS_TEAM]: [
        Permission.SUBMIT_REQUEST,
        Permission.ACKNOWLEDGE_REQUEST,
        Permission.VIEW_ALL_REQUESTS,
    ],
    [UserRole.MAINTENANCE_TEAM]: [
        Permission.APPROVE_REQUEST,
        Permission.REJECT_REQUEST,
        Permission.SEND_RFQ,
        Permission.ENTER_QUOTATION,
        Permission.COMPLETE_MAINTENANCE,
        Permission.ENTER_COSTS,
        Permission.VIEW_ALL_REQUESTS,
    ],
    [UserRole.FLEET_MANAGER]: [
        Permission.APPROVE_ESTIMATE,
        Permission.REJECT_ESTIMATE,
        Permission.VIEW_ALL_REQUESTS,
    ],
    [UserRole.ADMIN]: [
        Permission.SUBMIT_REQUEST,
        Permission.ACKNOWLEDGE_REQUEST,
        Permission.APPROVE_REQUEST,
        Permission.REJECT_REQUEST,
        Permission.SEND_RFQ,
        Permission.ENTER_QUOTATION,
        Permission.APPROVE_ESTIMATE,
        Permission.REJECT_ESTIMATE,
        Permission.COMPLETE_MAINTENANCE,
        Permission.ENTER_COSTS,
        Permission.CLOSE_JOB,
        Permission.VIEW_ALL_REQUESTS,
    ],
};

/**
 * Check if a user role has a specific permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
    const permissions = ROLE_PERMISSIONS[role];
    return permissions.includes(permission);
}

/**
 * Check if a user role has any of the specified permissions
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
    return permissions.some(permission => hasPermission(role, permission));
}

/**
 * Check if a user role has all of the specified permissions
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
    return permissions.every(permission => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(role: UserRole): Permission[] {
    return ROLE_PERMISSIONS[role] || [];
}

/**
 * Mock function to get current user role
 * TODO: Replace with actual authentication service
 */
export function getCurrentUserRole(): UserRole {
    // For development, return ADMIN
    // In production, this should fetch from authentication context
    return UserRole.ADMIN;
}

/**
 * Check if current user can perform an action
 */
export function canPerformAction(permission: Permission): boolean {
    const currentRole = getCurrentUserRole();
    return hasPermission(currentRole, permission);
}

/**
 * Throw error if user doesn't have permission
 */
export function requirePermission(permission: Permission): void {
    if (!canPerformAction(permission)) {
        throw new Error(`Permission denied: ${permission}`);
    }
}

/**
 * Get user-friendly role name
 */
export function getRoleName(role: UserRole): string {
    const roleNames: Record<UserRole, string> = {
        [UserRole.DRIVER]: 'Driver',
        [UserRole.OPERATIONS_TEAM]: 'Operations Team',
        [UserRole.MAINTENANCE_TEAM]: 'Maintenance Team',
        [UserRole.FLEET_MANAGER]: 'Fleet Manager',
        [UserRole.ADMIN]: 'Administrator',
    };
    return roleNames[role];
}

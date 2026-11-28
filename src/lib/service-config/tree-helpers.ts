/**
 * Browser-safe pure helpers for the /admin/service-config tree & editor.
 */

import type { ServiceCategoryWithTypes, ServiceType } from '@/types/service-config';

export interface DeleteCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Determine whether a Service Type can be deleted from the Service Configuration UI.
 * System types are protected from deletion so core modules remain intact; admins
 * can still rename/edit them or disable them in Service Catalog & SLA.
 */
export function canDeleteServiceType(type: Pick<ServiceType, 'isSystem'>): DeleteCheck {
  if (type.isSystem) {
    return {
      allowed: false,
      reason: 'System service types cannot be deleted. You can edit them here or disable them in Service Catalog & SLA.',
    };
  }
  return { allowed: true };
}

/**
 * Determine whether a Service Category can be deleted.
 * Mirrors DELETE /api/admin/service-config/categories/[id]:
 *   - System categories are protected.
 *   - Categories with one or more active service types must be emptied first.
 */
export function canDeleteServiceCategory(
  category: Pick<ServiceCategoryWithTypes, 'isSystem' | 'types'>,
): DeleteCheck {
  if (category.isSystem) {
    return {
      allowed: false,
      reason: 'System categories cannot be deleted.',
    };
  }
  if (category.types.length > 0) {
    return {
      allowed: false,
      reason: 'Delete or move all service types in this category before deleting it.',
    };
  }
  return { allowed: true };
}

/**
 * Pick the best fallback Service Type id to select after `deletedTypeId` is removed.
 * Preference order:
 *   1. Next sibling in the same category.
 *   2. Previous sibling in the same category.
 *   3. First remaining service type in any other category.
 *   4. null if no service types remain.
 */
export function pickNextSelectedTypeId(
  categories: readonly ServiceCategoryWithTypes[],
  deletedTypeId: string,
): string | null {
  for (const cat of categories) {
    const idx = cat.types.findIndex((t) => t.id === deletedTypeId);
    if (idx !== -1) {
      if (idx + 1 < cat.types.length) return cat.types[idx + 1].id;
      if (idx - 1 >= 0) return cat.types[idx - 1].id;
      break;
    }
  }

  for (const cat of categories) {
    const remaining = cat.types.find((t) => t.id !== deletedTypeId);
    if (remaining) return remaining.id;
  }

  return null;
}

/**
 * Validate a category or service type display name before saving.
 */
export function validateServiceConfigName(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Name is required.' };
  }
  return { ok: true, value: trimmed };
}

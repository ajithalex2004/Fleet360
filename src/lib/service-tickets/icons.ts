/**
 * Resolve a Lucide icon name (string, as stored on `service_types.icon`)
 * to the actual React component. The `service-config` engine stores icons
 * as strings so admins can edit the catalogue without code changes.
 *
 * Adding support for a new icon: add the import and the map entry. Names
 * not in the map fall back to `Headphones` (the module's parent icon).
 */

import {
  Wrench, Calendar, Sparkles, LifeBuoy, Siren, Truck,
  MessageSquareWarning, MessageCircle, Headphones, Bus, Car,
  type LucideIcon,
} from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Wrench, Calendar, Sparkles, LifeBuoy, Siren, Truck,
  MessageSquareWarning, MessageCircle, Headphones, Bus, Car,
};

/** Resolve an icon name to a Lucide component, with a Headphones fallback. */
export function getServiceIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Headphones;
  return ICON_MAP[name] ?? Headphones;
}

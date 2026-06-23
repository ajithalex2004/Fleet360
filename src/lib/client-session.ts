'use client';

export interface ClientMeResponse {
  userId?: string;
  tenantId?: string;
  tenantName?: string;
  plan?: string;
  role?: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  navPermissions?: Record<string, boolean>;
  enabledModules?: string[];
  impersonatedBy?: string | null;
  branding?: {
    productName: string | null;
    tagline: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  } | null;
}

let cachedMe: ClientMeResponse | null = null;
let cachedAt = 0;
let pendingMe: Promise<ClientMeResponse | null> | null = null;

const ME_TTL_MS = 60_000;

export function clearClientMeCache() {
  cachedMe = null;
  cachedAt = 0;
  pendingMe = null;
}

export async function getClientMe(forceRefresh = false): Promise<ClientMeResponse | null> {
  if (!forceRefresh && cachedMe && Date.now() - cachedAt < ME_TTL_MS) {
    return cachedMe;
  }
  if (!forceRefresh && pendingMe) return pendingMe;

  pendingMe = fetch('/api/auth/me')
    .then(r => (r.ok ? r.json() : null))
    .then((data: ClientMeResponse | null) => {
      cachedMe = data;
      cachedAt = Date.now();
      return data;
    })
    .catch(() => null)
    .finally(() => {
      pendingMe = null;
    });

  return pendingMe;
}

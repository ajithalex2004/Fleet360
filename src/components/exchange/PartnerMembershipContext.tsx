'use client';

/**
 * The transport partner the signed-in user acts for in the partner portal,
 * loaded once by the (exchange) layout from /api/exchange/partner/me and
 * shared with its pages, so the sidebar, header and dashboard name the real
 * partner instead of placeholder text.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

export interface PortalPartner {
  partnerId: string;
  role: string;
  legalName: string;
  partnerCode: string;
  city: string | null;
  marketplaceStatus: string;
  operationalStatus: string;
}

export type PartnerMembershipState =
  | { status: 'loading' }
  /** Exactly one membership: the partner the portal acts for. */
  | { status: 'ok'; partner: PortalPartner }
  /** Signed in, but not linked to any transport partner. */
  | { status: 'none' }
  /** Linked to several partners; the portal cannot pick one yet. */
  | { status: 'multiple'; partners: PortalPartner[] }
  | { status: 'error'; message: string };

const PartnerMembershipContext = createContext<PartnerMembershipState>({ status: 'loading' });

export function PartnerMembershipProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PartnerMembershipState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/exchange/partner/me');
        const d = (await r.json().catch(() => ({}))) as { partners?: PortalPartner[]; error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setState({ status: 'error', message: d.error ?? `Could not load your partner (${r.status})` });
          return;
        }
        const partners = d.partners ?? [];
        if (partners.length === 0) setState({ status: 'none' });
        else if (partners.length === 1) setState({ status: 'ok', partner: partners[0] });
        else setState({ status: 'multiple', partners });
      } catch {
        if (!cancelled) setState({ status: 'error', message: 'Could not load your partner' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return <PartnerMembershipContext.Provider value={state}>{children}</PartnerMembershipContext.Provider>;
}

export function usePartnerMembership(): PartnerMembershipState {
  return useContext(PartnerMembershipContext);
}

const ROLE_LABELS: Record<string, string> = {
  PARTNER_ADMIN: 'Admin',
  PARTNER_OPERATIONS: 'Operations',
  PARTNER_FINANCE: 'Finance',
  PARTNER_VIEWER: 'Viewer',
};

export function partnerRoleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Up to two initials of a company name, for the header avatar. */
export function partnerInitials(name: string): string {
  const words = name.replace(/\b(LLC|L\.L\.C\.?|FZE|FZCO|FZ-LLC|Co|Company|Ltd)\b\.?/gi, '').trim().split(/\s+/).filter(Boolean);
  return (words.slice(0, 2).map((w) => w[0]).join('') || name.slice(0, 2)).toUpperCase();
}

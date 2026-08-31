import React from 'react';
import TenantPortalShell, { useTenantPortal } from './tenant-portal-shell';

export { useTenantPortal };

export default function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  return <TenantPortalShell>{children}</TenantPortalShell>;
}

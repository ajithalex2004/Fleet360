import React from 'react';
import TenantPortalShell from './tenant-portal-shell';

export default function TenantPortalLayout({ children }: { children: React.ReactNode }) {
  return <TenantPortalShell>{children}</TenantPortalShell>;
}

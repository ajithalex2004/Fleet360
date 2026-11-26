export const dynamic = 'force-dynamic';

import React from 'react';
import PortalShell from './portal-shell';

export const metadata = { title: 'Customer Portal' };

export default function CustomerPortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}

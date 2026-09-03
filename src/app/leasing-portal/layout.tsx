export const dynamic = 'force-dynamic';

import React from 'react';
import LeasingPortalShell from './leasing-portal-shell';

export default function LeasingPortalLayout({ children }: { children: React.ReactNode }) {
  return <LeasingPortalShell>{children}</LeasingPortalShell>;
}

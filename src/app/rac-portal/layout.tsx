export const dynamic = 'force-dynamic';

import React from 'react';
import RacPortalShell from './rac-portal-shell';

export default function RacPortalLayout({ children }: { children: React.ReactNode }) {
  return <RacPortalShell>{children}</RacPortalShell>;
}

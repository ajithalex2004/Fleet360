import React from 'react';
import ShipperPortalShell from './shipper-portal-shell';

export default function ShipperPortalLayout({ children }: { children: React.ReactNode }) {
  return <ShipperPortalShell>{children}</ShipperPortalShell>;
}

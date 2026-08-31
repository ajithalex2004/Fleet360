import React from 'react';
import ComplianceShell from './compliance-shell';

export default function ComplianceLayout({ children }: { children: React.ReactNode }) {
  return <ComplianceShell>{children}</ComplianceShell>;
}

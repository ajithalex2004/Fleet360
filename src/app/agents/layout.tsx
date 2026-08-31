import React from 'react';
import AgentsShell from './agents-shell';

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <AgentsShell>{children}</AgentsShell>;
}

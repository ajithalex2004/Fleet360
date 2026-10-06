import React from 'react';
import type { Metadata, Viewport } from 'next';

// The token in the URL is a credential: never sent on as a referrer, never indexed.
export const metadata: Metadata = {
  title: 'Approval decision',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function ApprovalLinkLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

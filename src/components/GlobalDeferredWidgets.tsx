'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const BrandingProvider = dynamic(() => import('@/components/BrandingProvider'), {
  ssr: false,
  loading: () => null,
});
const ImpersonationBanner = dynamic(() => import('@/components/ImpersonationBanner'), {
  ssr: false,
  loading: () => null,
});
const SubscriptionBanner = dynamic(() => import('@/components/SubscriptionBanner'), {
  ssr: false,
  loading: () => null,
});
const ChatWidgetLoader = dynamic(() => import('@/components/Communication/ChatWidgetLoader'), {
  ssr: false,
  loading: () => null,
});

export default function GlobalDeferredWidgets() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const activate = () => setEnabled(true);
    const idleGlobal = globalThis as IdleGlobals;
    if (typeof idleGlobal.requestIdleCallback === 'function') {
      const id = idleGlobal.requestIdleCallback(activate, { timeout: 1500 });
      return () => idleGlobal.cancelIdleCallback?.(id);
    }
    const id = globalThis.setTimeout(activate, 800);
    return () => globalThis.clearTimeout(id);
  }, []);

  if (!enabled) return null;

  return (
    <>
      <BrandingProvider />
      <ImpersonationBanner />
      <SubscriptionBanner />
      <ChatWidgetLoader />
    </>
  );
}

type IdleGlobals = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

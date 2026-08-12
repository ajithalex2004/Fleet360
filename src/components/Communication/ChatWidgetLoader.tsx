'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

// ssr: false is only allowed inside a Client Component.
// This wrapper keeps layout.tsx (a Server Component) clean while
// still deferring ChatWidget to its own JS chunk.
const ChatWidget = dynamic(
  () => import('./ChatWidget'),
  { ssr: false, loading: () => null }
);

export default function ChatWidgetLoader() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const activate = () => setEnabled(true);
    const idleGlobal = globalThis as IdleGlobals;
    if (typeof idleGlobal.requestIdleCallback === 'function') {
      const id = idleGlobal.requestIdleCallback(activate, { timeout: 5000 });
      return () => idleGlobal.cancelIdleCallback?.(id);
    }
    const id = globalThis.setTimeout(activate, 3000);
    return () => globalThis.clearTimeout(id);
  }, []);

  return enabled ? <ChatWidget /> : null;
}

type IdleGlobals = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

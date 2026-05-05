'use client';

import dynamic from 'next/dynamic';

// ssr: false is only allowed inside a Client Component.
// This wrapper keeps layout.tsx (a Server Component) clean while
// still deferring ChatWidget to its own JS chunk.
const ChatWidget = dynamic(
  () => import('./ChatWidget'),
  { ssr: false, loading: () => null }
);

export default function ChatWidgetLoader() {
  return <ChatWidget />;
}

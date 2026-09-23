'use client';

import dynamic from 'next/dynamic';

// The @thesysai/genui-sdk chat widget (C1Chat) touches `document` directly
// during its own render/init path (not gated behind a browser check), so it
// breaks Next's server-side static export ("document is not defined").
// ssr: false keeps it out of the server render entirely — it only mounts in
// the browser after hydration, matching the same pattern used for other
// browser-only widgets (see FleetLiveMap, RouteOptimizerPanel).
const ChatInterface = dynamic(() => import('@/components/ChatInterface'), { ssr: false });

export default function ChatPage() {
  return <ChatInterface />;
}

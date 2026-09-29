'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders a side panel (drawer) at document.body, above the app's top bar.
 *
 * A drawer rendered inside a page sits in the page content's stacking
 * context, so however high its z-index the app top bar paints over its
 * header. Portalled to the body in a z-[70] layer it covers the whole
 * viewport; modals the drawer opens are rendered inside it and stack
 * above it by their own z-index.
 */
export function DrawerPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="relative z-[70]">{children}</div>, document.body);
}

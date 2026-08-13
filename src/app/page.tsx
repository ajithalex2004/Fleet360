/**
 * / — server-side redirect to /platform.
 *
 * The previous implementation was a 'use client' component that mounted a
 * spinner, then called `router.replace('/platform')` from useEffect. Every
 * visitor paid the cost of downloading the root JS bundle, hydrating it,
 * firing the effect, and only then starting the navigation — a 400-800ms
 * wasted spinner on the worst entry path (typed URL, stale bookmark, deep
 * link).
 *
 * A server component calling `redirect()` issues a 307 with a Location
 * header before any JS ships, so the browser follows the redirect
 * immediately on first paint. No client code, no spinner, no useEffect.
 */

import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/platform');
}

/**
 * src/components/driver-app/BackButton.tsx
 *
 * Standardised back button for every page in the driver app
 * (except /menu, which is the hub and has no logical "back").
 *
 * Uses `router.back()` so the user returns to the exact page they
 * came from (usually /menu, but could be /today or the launcher).
 * Falls back to /menu if the history stack is empty (e.g. when
 * the user deep-linked into the page).
 *
 * The chevron is a 24×24 inline SVG so it inherits `currentColor`
 * and stays crisp at any size. The 44×44 tap target is the iOS /
 * Android Material minimum for primary touch targets.
 */
'use client';

import { useRouter } from 'next/navigation';

export function BackButton({ fallbackHref = '/driver-app/menu' }: { fallbackHref?: string }) {
  const router = useRouter();
  const onClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/5 active:bg-white/10"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 18l-6-6 6-6" />
      </svg>
    </button>
  );
}

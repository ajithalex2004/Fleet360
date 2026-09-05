import type { Metadata } from "next";
import "./globals.css";
import ToastProvider from "@/components/providers/ToastProvider";
import ClientProviders from "@/components/ClientProviders";
import GlobalDeferredWidgets from "@/components/GlobalDeferredWidgets";
import { ThemeProvider } from "@/components/ThemeProvider";
import CommandPalette from "@/components/navigation/CommandPalette";
import ChunkErrorReloader from "@/components/ChunkErrorReloader";

export const metadata: Metadata = {
  title: "Fleet360",
  description: "Unified Transport Management Platform",
};

// Applies the saved theme class to <html> before paint, so there is no flash of
// the wrong theme on load. Defaults to dark (the app's baseline).
//
// The driver app (/driver-app/*) is permanently dark — drivers in the
// desert need high contrast and the mobile UI was designed dark-only.
// We force dark for those routes regardless of the saved preference.
const THEME_NO_FLASH = `(function(){try{var path=window.location.pathname;var isDriverApp=path.indexOf('/driver-app')===0;var c=localStorage.getItem('fleet360-theme')||'dark';var d=isDriverApp||c==='dark'||(c==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.add(d?'dark':'light');e.style.colorScheme=d?'dark':'light';}catch(_){document.documentElement.classList.add('dark');}})();`;

// Registers the stale-chunk recovery listener before any webpack chunk —
// including the root layout's own chunk — has a chance to load. The React
// ChunkErrorReloader component (mounted below) can only catch failures that
// happen after React itself has booted; a failure loading app/layout's own
// chunk happens *before* that, so without this plain script running first,
// that specific failure mode falls through with no recovery at all.
const CHUNK_ERROR_RECOVERY = `(function(){var K='fleet360-chunk-reload-at',W=10000;function isChunkErr(v){if(!v)return false;var t=typeof v==='string'?v:(v.message||v.name||String(v));return /ChunkLoadError|Loading chunk [0-9]+ failed|failed to fetch dynamically imported module/i.test(t);}function reloadOnce(){var last=0;try{last=Number(sessionStorage.getItem(K)||0);}catch(_){}var now=Date.now();if(now-last<W)return;try{sessionStorage.setItem(K,String(now));}catch(_){}window.location.reload();}window.addEventListener('error',function(e){if(isChunkErr(e.message)||isChunkErr(e.error))reloadOnce();});window.addEventListener('unhandledrejection',function(e){if(isChunkErr(e.reason))reloadOnce();});})();`;

// One-time cleanup for a real bug, not a deploy artifact: rental/counter's
// service worker used to register with no explicit scope. An unscoped
// register() for a script served from the site root defaults to
// controlling the ENTIRE origin, so any tab that ever visited
// /rental/counter got a worker that cache-first-served every full-page
// navigation app-wide — including routes that have nothing to do with the
// counter screen. That's what was actually behind the "stale chunk /
// ChunkLoadError" reports on unrelated pages: the worker kept returning an
// old cached HTML shell referencing chunk files a newer deploy had already
// deleted, before the request ever reached the network. The registration
// itself is now scoped to /rental/counter, but that fix only governs future
// installs — this unregisters any already-installed worker whose scope
// isn't correctly narrowed, clears its cache, and reloads once so the
// affected tab immediately starts hitting the network again.
const SW_SCOPE_CLEANUP = `(function(){if(!('serviceWorker' in navigator))return;navigator.serviceWorker.getRegistrations().then(function(regs){var bad=regs.filter(function(r){return !(r.scope&&r.scope.indexOf('/rental/counter')!==-1);});if(bad.length===0)return;Promise.all(bad.map(function(r){return r.unregister();})).then(function(){if('caches' in window){caches.keys().then(function(keys){keys.forEach(function(k){caches.delete(k);});}).catch(function(){});}var K='fleet360-sw-cleanup-reload-at',W=10000,last=0;try{last=Number(sessionStorage.getItem(K)||0);}catch(_){}var now=Date.now();if(now-last<W)return;try{sessionStorage.setItem(K,String(now));}catch(_){}window.location.reload();});}).catch(function(){});})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHUNK_ERROR_RECOVERY }} />
        <script dangerouslySetInnerHTML={{ __html: SW_SCOPE_CLEANUP }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH }} />
      </head>
      <body className="antialiased min-h-screen bg-[var(--bg-canvas)] text-[var(--text-main)] transition-colors duration-150">
        <ChunkErrorReloader />
        <ThemeProvider>
          <ClientProviders>
            <ToastProvider>
              {children}
              <CommandPalette />
              <GlobalDeferredWidgets />
            </ToastProvider>
          </ClientProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}

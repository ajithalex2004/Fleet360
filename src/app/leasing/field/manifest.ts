import type { MetadataRoute } from 'next';

/**
 * PWA manifest for the Leasing Field-Ops app — mobile-installable.
 * Operators install once via "Add to Home Screen" and capture mileage
 * readings, fuel logs, and traffic fines while on the road.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet360 — Leasing Field',
    short_name: 'Lease Field',
    description: 'Mobile field-ops capture for leasing: mileage, fuel, traffic fines.',
    start_url: '/leasing/field',
    scope: '/leasing/field',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#10b981',
    icons: [
      { src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' },
    ],
  };
}

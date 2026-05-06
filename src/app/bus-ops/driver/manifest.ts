import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'XL AI Smart Mobility — Bus Driver',
    short_name: 'Bus Driver',
    description: 'On-the-road app for staff bus drivers: depart, board, complete, incident.',
    start_url: '/bus-ops/driver',
    scope: '/bus-ops/driver',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#7c3aed',
    icons: [{ src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' }],
  };
}

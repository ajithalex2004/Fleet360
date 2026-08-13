import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet360 SchoolBus Driver',
    short_name: 'F360 SB Driver',
    description: 'On-the-road app for school bus drivers and attendants — pre-trip safety check, RFID/code scanning, manifest, incident reporting.',
    start_url: '/school-bus/driver',
    scope: '/school-bus/driver',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#dc2626',
    icons: [{ src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' }],
  };
}

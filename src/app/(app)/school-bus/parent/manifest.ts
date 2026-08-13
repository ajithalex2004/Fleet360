import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet360 SchoolBus Parent',
    short_name: 'F360 Parent',
    description: 'Parents and guardians: today\'s school bus, ETA at home stop, attendance, absence registration, push alerts.',
    start_url: '/school-bus/parent',
    scope: '/school-bus/parent',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#f59e0b',
    icons: [{ src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' }],
  };
}

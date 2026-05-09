import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fleet360 STS Passenger',
    short_name: 'F360 Passenger',
    description: 'Staff transport companion — today\'s bus, BLE/NFC/QR boarding, absence registration, waitlist join.',
    start_url: '/bus-ops/passenger',
    scope: '/bus-ops/passenger',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#06b6d4',
    icons: [{ src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' }],
  };
}

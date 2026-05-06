import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'XL AI Smart Mobility — My Bus',
    short_name: 'My Bus',
    description: 'Staff transport companion: today\'s bus, board check-in (BLE/QR/NFC), absence registration.',
    start_url: '/bus-ops/passenger',
    scope: '/bus-ops/passenger',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#06b6d4',
    icons: [{ src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' }],
  };
}

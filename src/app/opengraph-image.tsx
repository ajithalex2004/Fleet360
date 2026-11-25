import { ImageResponse } from 'next/og';

export const alt = 'Fleet360 — Connect your fleet. Transform it into AI-driven Smart Mobility.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Social share card in the editorial Paper & Ember style.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: '#fbfaf7', color: '#121212', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #121212', paddingBottom: 28 }}>
          <div style={{ display: 'flex', fontSize: 44, fontWeight: 700 }}>
            Fleet<span style={{ color: '#c2410c', fontStyle: 'italic' }}>360</span>
          </div>
          <div style={{ display: 'flex', fontSize: 22, letterSpacing: 4, color: '#5c5a55' }}>AI-ORCHESTRATED FLEET INTELLIGENCE · UAE & GCC</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 96, fontWeight: 700, lineHeight: 1.02, letterSpacing: -2 }}>
          <span>Connect your fleet.</span>
          <span style={{ display: 'flex', fontSize: 64, marginTop: 12 }}>
            Transform it into AI-driven&nbsp;<span style={{ color: '#c2410c', fontStyle: 'italic' }}>Smart Mobility</span>
          </span>
        </div>
        <div style={{ display: 'flex', fontSize: 28, color: '#5c5a55' }}>
          Vehicles, drivers, routes, maintenance, finance and compliance — orchestrated by governed AI agents.
        </div>
      </div>
    ),
    size,
  );
}

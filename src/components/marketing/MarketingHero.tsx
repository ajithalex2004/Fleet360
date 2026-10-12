import Link from 'next/link';
import type { HomepageSnapshot } from '@/lib/public-homepage';
import styles from './MarketingHero.module.css';

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

const Brand = () => (
  <Link className={styles.brand} href="/" aria-label="Fleet360 home">
    <span>FLEET</span><strong>360</strong>
  </Link>
);

function NetworkScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={styles.horizon} />
      <svg className={styles.map} viewBox="0 0 1000 760" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="route" x1="0" x2="1">
            <stop offset="0" stopColor="#baff69" stopOpacity="0" />
            <stop offset=".26" stopColor="#9dff42" />
            <stop offset="1" stopColor="#e0ff9f" />
          </linearGradient>
          <linearGradient id="road" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#82907c" stopOpacity=".03" />
            <stop offset=".5" stopColor="#b3c6a8" stopOpacity=".34" />
            <stop offset="1" stopColor="#82907c" stopOpacity=".03" />
          </linearGradient>
          <radialGradient id="core">
            <stop offset="0" stopColor="#d9ffad" />
            <stop offset=".18" stopColor="#91ff32" />
            <stop offset="1" stopColor="#91ff32" stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="blocks" width="54" height="42" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
            <rect width="38" height="24" x="8" y="8" rx="2" fill="#e9c680" fillOpacity=".07" stroke="#f2d49a" strokeOpacity=".08" />
          </pattern>
        </defs>

        <path className={styles.coast} d="M70 45C278 104 274 262 414 318c122 48 183-50 300-1 101 43 125 142 233 164v279H0V137c25-45 35-71 70-92Z" />
        <path className={styles.cityGrid} d="M326 40h674v720H84c102-59 167-150 219-245 61-111 61-210 23-475Z" />

        <g className={styles.roads} fill="none" stroke="url(#road)">
          <path d="M124 706C276 597 344 531 468 422S682 172 966 69" />
          <path d="M166 760C319 644 399 588 529 500S750 329 1006 259" />
          <path d="M417 760c58-144 107-223 205-335s174-186 302-266" />
          <path d="M255 96c133 112 193 188 216 298 28 135 29 221 16 366" />
          <path d="M354 39c81 96 134 180 168 292 36 121 85 250 223 429" />
          <path d="M143 469c191-2 342-18 467-78 139-66 242-129 390-145" />
          <path d="M79 580c173-12 301-36 425-108 131-76 273-156 496-168" />
        </g>

        <g className={styles.routeGlow} fill="none" stroke="url(#route)" strokeLinecap="round" filter="url(#glow)">
          <path d="M112 705C268 604 345 529 467 423S676 180 949 76" />
          <path d="M168 758C322 647 402 589 530 501S754 330 994 264" />
          <path d="M417 760c59-145 108-225 205-335s174-186 302-266" />
        </g>

        <g className={styles.skyline}>
          <path d="M660 281v-96h13v96m15 0V117h18v164m13 0V153h14v128m13 0V61h18v220m15 0V133h17v148m18 0V89h14v192m19 0V167h18v114m16 0V125h14v156m20 0v-88h13v88" />
          <path className={styles.spire} d="M746 281V54l9-39 9 39v227" />
        </g>

        <g className={styles.nodes} filter="url(#glow)">
          <circle cx="468" cy="423" r="34" fill="url(#core)" />
          <circle cx="468" cy="423" r="7" />
          <circle cx="622" cy="425" r="5" />
          <circle cx="793" cy="304" r="5" />
          <circle cx="905" cy="165" r="5" />
          <circle cx="530" cy="501" r="5" />
          <circle cx="418" cy="649" r="5" />
          <circle cx="286" cy="597" r="5" />
        </g>

        <g className={styles.incident} filter="url(#glow)">
          <circle cx="823" cy="416" r="7" />
          <circle cx="823" cy="416" r="24" fill="none" />
          <circle cx="823" cy="416" r="46" fill="none" />
        </g>
      </svg>

      <div className={`${styles.signal} ${styles.signalVehicle}`}>
        <span>Vehicles</span><strong>392</strong><small>on route</small>
      </div>
      <div className={`${styles.signal} ${styles.signalDepot}`}>
        <span>Depot</span><strong>Jebel Ali</strong><small>18 vehicles</small>
      </div>
      <div className={`${styles.signal} ${styles.signalIncident}`}>
        <span>Incident</span><strong>E11 southbound</strong><small>response coordinated</small>
      </div>
      <div className={styles.orchestrator}>
        <span>Fleet360</span><strong>Orchestrator</strong><i />
      </div>
    </div>
  );
}

const metrics = [
  { value: '392', label: 'Vehicles live', icon: 'vehicle' },
  { value: '78%', label: 'Fleet utilization', icon: 'signal' },
  { value: '99.7%', label: 'Uptime this month', icon: 'shield' },
  { value: '28%', label: 'Lower operating costs', icon: 'cost' },
];

function MetricIcon({ type }: { type: string }) {
  if (type === 'vehicle') return <path d="M3 13V8l2-4h9l3 4h2a2 2 0 0 1 2 2v3h-2m-12 0H3m4 0a2 2 0 1 0 4 0m6 0a2 2 0 1 0 4 0M6 8h10" />;
  if (type === 'signal') return <path d="M4 19v-4h3v4m3 0V9h3v10m3 0V4h3v15M2 21h20" />;
  if (type === 'shield') return <path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4Zm-4 10 2.5 2.5L16 9" />;
  return <path d="M4 6c0-2 3.6-4 8-4s8 2 8 4-3.6 4-8 4-8-2-8-4Zm0 0v6c0 2 3.6 4 8 4s8-2 8-4V6M4 12v6c0 2 3.6 4 8 4s8-2 8-4v-6" />;
}

export default function MarketingHero({ snapshot }: { snapshot: HomepageSnapshot }) {
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <NetworkScene />
        <div className={styles.vignette} />

        <header className={styles.header}>
          <Brand />
          <nav className={styles.desktopNav} aria-label="Primary navigation">
            <Link href="/platform">Platform</Link>
            <Link href="/agents">AI agents</Link>
            <Link href="/ai-platform">Governed AI</Link>
            <Link href="/login">Sign in <Arrow /></Link>
          </nav>
          <details className={styles.mobileNav}>
            <summary aria-label="Open navigation"><span /><span /><span /></summary>
            <nav aria-label="Mobile navigation">
              <Link href="/platform">Platform</Link>
              <Link href="/agents">AI agents</Link>
              <Link href="/ai-platform">Governed AI</Link>
              <Link href="/login">Sign in</Link>
            </nav>
          </details>
        </header>

        <div className={styles.heroInner}>
          <div className={styles.statusRow} aria-label="Platform qualities">
            <span>Live operations</span>
            <span>UAE-ready</span>
            <span>Multi-tenant control</span>
          </div>

          <div className={styles.copy}>
            <p className={styles.eyebrow}>The intelligent command layer</p>
            <h1 id="hero-title">
              Smart Mobility Hub.
              <span>AI-Orchestrated Fleet360 Intelligence.</span>
            </h1>
            <p className={styles.lede}>
              Unify your entire fleet, drivers, routes, maintenance, finance, and compliance in one intelligent platform—where specialized AI agents orchestrate operational intelligence and complete control.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryAction} href="/operations-review" data-analytics-cta="hero_operations_review">
                Book an operations review <Arrow />
              </Link>
              <Link className={styles.secondaryAction} href="/platform" data-analytics-cta="hero_platform">
                Explore the platform <Arrow />
              </Link>
            </div>
          </div>

          <div className={styles.scrollCue} aria-hidden="true"><span /> Scroll to explore</div>
        </div>

        <div className={styles.metrics} aria-label={`${snapshot.source === 'configured' ? 'Live' : 'Illustrative'} operations snapshot`}>
          <span className={styles.metricsLabel}>{snapshot.source === 'configured' ? 'Live command view' : 'Illustrative command view'}</span>
          {metrics.map((metric) => {
            const value = metric.icon === 'vehicle' ? snapshot.vehiclesLive.toLocaleString() : metric.icon === 'signal' ? `${snapshot.fleetUtilization}%` : metric.icon === 'shield' ? `${snapshot.uptime}%` : `${snapshot.lowerOperatingCosts}%`;
            return (
            <div className={styles.metric} key={metric.label}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><MetricIcon type={metric.icon} /></svg>
              <div><strong>{value}</strong><span>{metric.label}</span></div>
            </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

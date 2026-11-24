import Link from 'next/link';
import type { HomepageSnapshot } from '@/lib/public-homepage';
import s from './Editorial.module.css';

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

const NAV = [
  { href: '/platform', label: 'Platform' },
  { href: '/logistics/drayage', label: 'Drayage' },
  { href: '/agents', label: 'AI agents' },
  { href: '/ai-platform', label: 'Governed AI' },
];

const MODULES = [
  'Fleet & assets', 'Port drayage', 'PCS gate tokens', 'Leasing', 'Rent-a-car', 'Bus operations',
  'Driver app', 'Maintenance', 'Service tickets', 'Booking portal', 'Fleet360 Exchange', 'Finance & settlement',
  'Compliance', 'Incidents', 'Governed AI agents',
];

const DOMAINS = [
  ['Fleet & Assets', 'Vehicles, telematics and lifecycle cost in one register.'],
  ['Booking Portal & Live Dispatch', 'Customer bookings flow straight into routes and capacity planned against real-time demand.'],
  ['Planned & Predictive Maintenance', 'Preventive schedules, predicted failures and work orders before vehicles go down.'],
  ['Logistics & Fleet Exchange', 'Shipments, drayage and partner capacity through Fleet360 Exchange.'],
  ['Rental & Leasing', 'Contracts, utilisation and yield across every vehicle.'],
  ['Staff & School Transport', 'People movement with safeguarding built in.'],
  ['Finance & VAT', 'Costs, settlement and reconciliation, VAT-ready.'],
  ['Compliance & ESG', 'Authority workflows and reporting.'],
  ['Governed AI Agents', 'Recommendations and actions inside your policy.'],
  ['Fleet Market', 'Post overflow bus, limousine and recovery jobs to vetted partner fleets.'],
];

const EVENT_CHAIN = ['Vehicle fault', 'Capacity updated', 'Replacement assigned', 'Customer notified', 'Cost reconciled'];

const AGENTS = [
  ['Dispatch', 'Capacity and route intent', 'Acts', 'ok'],
  ['Maintenance', 'Predictive readiness', 'Acts', 'ok'],
  ['Safety', 'Risk and escalation', 'Escalates', 'warn'],
  ['Finance', 'Cost-to-serve signals', 'Needs approval', 'warn'],
  ['Compliance', 'Authority workflows', 'Acts', 'ok'],
  ['Customer ops', 'Service continuity', 'Acts', 'ok'],
] as const;

const AGENT_STEPS = ['Detect', 'Analyze', 'Recommend', 'Approve', 'Act', 'Learn'];

const REGION = [
  ['Authority workflows', 'Vehicle and permit readiness, with renewals flagged before they lapse.'],
  ['Regional operations', 'UAE, KSA and wider GCC context in every decision.'],
  ['Local controls', 'Arabic-ready records and a complete audit trail.'],
];

const CONTROLS = [
  ['Policy gate', 'Every recommendation is checked against role, tenant and operating policy.'],
  ['Human approval', 'High-impact actions pause for accountable review before execution.'],
  ['Complete audit', 'Decisions, evidence and outcomes remain traceable end to end.'],
];

const OUTCOMES = [
  ['Availability', 'More vehicles ready for work.'],
  ['Response', 'Faster operational decisions.'],
  ['Resilience', 'Less unplanned downtime.'],
  ['Control', 'Stronger compliance and cost visibility.'],
];

const pad = (n: number) => String(n).padStart(2, '0');

function SectionHead({ index, name, id, children, lede }: { index: number; name: string; id: string; children: React.ReactNode; lede?: string }) {
  return (
    <div className={s.secHead}>
      <span className={s.label}>§ {pad(index)} — {name}</span>
      <div>
        <h2 id={id} className={s.head}>{children}</h2>
        {lede && <p>{lede}</p>}
      </div>
    </div>
  );
}

export function EditorialHero({ snapshot }: { snapshot: HomepageSnapshot }) {
  const isLive = snapshot.source === 'configured';
  return (
    <div className={s.wrap} data-analytics-section="hero">
      <header className={s.nav}>
        <Link className={s.brand} href="/" aria-label="Fleet360 home">Fleet<b>360</b></Link>
        <nav className={s.navLinks} aria-label="Primary navigation">
          {NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        </nav>
        <Link className={`${s.btn} ${s.navSignIn}`} href="/login" data-analytics-cta="hero_signin">Sign in <Arrow /></Link>
        <details className={s.mobileNav}>
          <summary aria-label="Open navigation"><span /><span /><span /></summary>
          <nav aria-label="Mobile navigation">
            {NAV.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            <Link href="/login">Sign in</Link>
          </nav>
        </details>
      </header>

      <section className={s.hero} aria-labelledby="hero-title">
        <div>
          <p className={`${s.kicker} ${s.label}`}>AI-orchestrated fleet intelligence · UAE &amp; GCC</p>
          <h1 id="hero-title" className={s.head}>Your whole fleet, <em>thinking</em> as one.</h1>
          <p className={s.lede}>
            Vehicles, drivers, containers, leases and buses, all on one live map and orchestrated by governed AI
            agents. See every move. Decide in seconds. Act with confidence.
          </p>
          <div className={s.actions}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/operations-review" data-analytics-cta="hero_operations_review">
              Book an operations review <Arrow />
            </Link>
            <Link className={s.btn} href="/platform" data-analytics-cta="hero_platform">Explore the platform</Link>
          </div>
          <div className={`${s.qualities} ${s.label}`} aria-label="Platform qualities">
            <span>UAE / GCC ready</span><span>Multi-tenant isolation</span><span>Human-approved AI</span>
          </div>
        </div>

        <figure className={s.figure} aria-label={`${isLive ? 'Live' : 'Illustrative'} operations snapshot`}>
          <div className={`${s.figHead} ${s.label}`}>
            <span>Fig. 01 — {isLive ? 'Live command view' : 'Illustrative command view'}</span>
            <span className={s.live}>● {isLive ? 'Live' : 'Sample'}</span>
          </div>
          <svg viewBox="0 0 400 300" fill="none" aria-hidden="true">
            <g stroke="#e7e4dc"><path d="M0 60h400M0 120h400M0 180h400M0 240h400M80 0v300M160 0v300M240 0v300M320 0v300" /></g>
            <path d="M0 230 C90 210 120 150 200 140 S330 70 400 40" stroke="#121212" strokeWidth="1.5" />
            <path className={s.route} d="M20 280 C120 250 170 200 230 190 S340 150 390 110" stroke="#c2410c" strokeWidth="2" />
            <path d="M60 20 C110 90 140 170 150 300" stroke="#121212" strokeWidth="1" opacity=".5" />
            <circle cx="200" cy="140" r="6" fill="#121212" />
            <circle cx="200" cy="140" r="16" stroke="#121212" opacity=".25" />
            <circle cx="230" cy="190" r="5" fill="#c2410c" />
            <circle cx="330" cy="88" r="4" fill="#121212" />
            <text x="212" y="134" fontFamily="ui-monospace, monospace" fontSize="9" fill="#121212">JEBEL ALI T1 · 08:00 GST</text>
            <text x="240" y="206" fontFamily="ui-monospace, monospace" fontSize="9" fill="#c2410c">E11 · REROUTED</text>
          </svg>
          <div className={s.figFoot}>
            <div><strong>{snapshot.vehiclesLive.toLocaleString()}</strong><small className={s.label}>Vehicles live</small></div>
            <div><strong>{snapshot.fleetUtilization}%</strong><small className={s.label}>Utilization</small></div>
            <div><strong>{snapshot.uptime}%</strong><small className={s.label}>Uptime</small></div>
          </div>
        </figure>
      </section>
    </div>
  );
}

export function ModuleStrip() {
  const items = [...MODULES, ...MODULES];
  return (
    <div className={s.strip} aria-label={`Modules: ${MODULES.join(', ')}`}>
      <div className={s.stripTrack} aria-hidden="true">
        {items.map((m, i) => <span key={`${m}-${i}`}>{m} <i>✦</i></span>)}
      </div>
    </div>
  );
}

export function EditorialPlatform() {
  return (
    <section className={`${s.wrap}`} aria-labelledby="platform-title" data-analytics-section="unified-platform">
      <div className={s.block}>
        <SectionHead index={1} name="Platform" id="platform-title"
          lede="Fleet360 connects vehicles, drivers, dispatch, maintenance, leasing, logistics, finance and compliance through one shared intelligence layer.">
          One platform. <em>Every</em> operation connected.
        </SectionHead>
        <div className={s.grid3}>
          {DOMAINS.map(([name, detail], i) => (
            <div className={s.cell} key={name}><span className={s.label}>{pad(i + 1)}</span><h3>{name}</h3><p>{detail}</p></div>
          ))}
        </div>
        <div className={s.sequence} aria-label="One event, every system informed">
          {EVENT_CHAIN.map((e, i) => <span key={e} className={i === 0 ? s.first : undefined}>{e}</span>)}
        </div>
      </div>
    </section>
  );
}

export function EditorialAgents() {
  return (
    <section className={s.wrap} aria-labelledby="agents-title" data-analytics-section="ai-orchestration">
      <div className={s.block}>
        <SectionHead index={2} name="AI agents" id="agents-title">
          Specialized agents. <em>One</em> coordinated operation.
        </SectionHead>
        <div className={s.split}>
          <div>
            <p className={s.quote}>
              Agents detect risk, analyze context, recommend the next move and coordinate execution, with
              <em> people and policy</em> in control.
            </p>
            <div className={s.note}>
              <strong>Governed autonomy</strong>
              Every action follows permissions, approval thresholds and a complete audit trail.
            </div>
          </div>
          <div className={s.log}>
            <div className={`${s.logHead} ${s.label}`}><span>Agent roster</span><span>Mode</span></div>
            {AGENTS.map(([name, detail, mode, tone], i) => (
              <div className={s.logRow} key={name}>
                <span>{pad(i + 1)}</span>
                <span><b>{name}</b><small>{detail}</small></span>
                <span className={tone === 'ok' ? s.tagOk : s.tagWarn}>{mode}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={s.sequence} aria-label="Agent decision sequence">
          {AGENT_STEPS.map((step, i) => <span key={step} className={i === 0 ? s.first : undefined}>{step}</span>)}
        </div>
      </div>
    </section>
  );
}

export function EditorialRegion() {
  return (
    <section className={s.wrap} aria-labelledby="gcc-title" data-analytics-section="gcc-intelligence">
      <div className={s.block}>
        <SectionHead index={4} name="UAE / GCC" id="gcc-title"
          lede="Regional operating context in every decision, so vehicle records, permits, compliance and dispatch move together across borders and business units.">
          Built for the region. <em>Ready</em> for every authority.
        </SectionHead>
        <div className={s.grid3}>
          {REGION.map(([title, detail], i) => (
            <div className={s.cell} key={title}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
          ))}
        </div>
        <div className={s.cities} aria-label="Cities">
          <span>Dubai</span><span>✦</span><span>Abu Dhabi</span><span>✦</span><span>Riyadh</span><span>✦</span><span>Doha</span><span>✦</span><span>Muscat</span>
        </div>
      </div>
    </section>
  );
}

export function EditorialGovernance() {
  return (
    <section className={s.wrap} aria-labelledby="governed-title" data-analytics-section="governed-ai">
      <div className={s.block}>
        <SectionHead index={5} name="Governed AI" id="governed-title"
          lede="Least-privilege access, tenant-aware controls, explainable recommendations and a clear human decision boundary.">
          Intelligence with <em>accountability.</em>
        </SectionHead>
        <div className={s.grid3}>
          {CONTROLS.map(([title, detail], i) => (
            <div className={s.cell} key={title}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function EditorialOutcomes({ snapshot }: { snapshot: HomepageSnapshot }) {
  const isLive = snapshot.source === 'configured';
  return (
    <section className={s.wrap} aria-labelledby="outcomes-title" data-analytics-section="operational-outcomes">
      <div className={s.block}>
        <SectionHead index={6} name="Outcomes" id="outcomes-title">
          Intelligence measured in <em>operational outcomes.</em>
        </SectionHead>
        <div className={s.numbers}>
          <div className={s.bigStat}>
            <strong>−{snapshot.lowerOperatingCosts}<sup>%</sup></strong>
            <span>lower operating costs{isLive ? '' : ' (illustrative)'}</span>
          </div>
          <div className={s.grid2}>
            {OUTCOMES.map(([title, detail], i) => (
              <div className={s.cell} key={title}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function EditorialClosing() {
  return (
    <div className={s.wrap}>
      <section className={s.cta} aria-labelledby="conversion-title" data-analytics-section="final-conversion">
        <p className={`${s.kicker} ${s.label}`}>Operations review</p>
        <h2 id="conversion-title" className={s.head}>Make every moving part <em>move with intent.</em></h2>
        <p>Bring your operation into one intelligent command layer. We’ll map the first high-value workflow together.</p>
        <div className={s.actions}>
          <Link className={`${s.btn} ${s.btnSolid}`} href="/operations-review" data-analytics-cta="final_operations_review">
            Book an operations review <Arrow />
          </Link>
          <Link className={s.btn} href="/platform" data-analytics-cta="final_platform">Explore Fleet360</Link>
        </div>
      </section>
      <footer className={`${s.footer} ${s.label}`}>
        <span>© {new Date().getFullYear()} Fleet360</span>
        <span>Private by design · UAE / GCC ready · Built for operators</span>
        <Link href="/login">Sign in →</Link>
      </footer>
    </div>
  );
}

export const editorialPageClass = s.page;

import { Fragment } from 'react';
import Link from 'next/link';
import type { HomepageSnapshot } from '@/lib/public-homepage';
import HeroStage from './HeroStage';
import { CountUp } from './SiteChrome';
import s from './Editorial.module.css';

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h13M14 7l5 5-5 5" />
  </svg>
);

// Hero headline: one array per line; words in HEADLINE_EMPHASIS get the accent.
const HEADLINE: string[][] = [
  ['Connect', 'your', 'fleet.'],
  ['Transform', 'it', 'into', 'AI-driven', 'Smart', 'Mobility'],
];
const HEADLINE_EMPHASIS = new Set(['Smart', 'Mobility']);

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
  ['Fleet360 Market', 'Post overflow bus, limousine and recovery jobs to vetted partner fleets.'],
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
    <div className={s.secHead} data-reveal="">
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
      <section className={s.hero} aria-labelledby="hero-title" id="top">
        <div className={s.heroCopy}>
          <p className={`${s.kicker} ${s.label} ${s.enter}`} style={{ '--d': '0ms' } as React.CSSProperties}>
            AI-orchestrated fleet intelligence · UAE &amp; GCC
          </p>
          <h1 id="hero-title" className={s.head}>
            {HEADLINE.map((line, l) => (
              <span key={l} className={s.heroLine}>
                {line.map((w, i) => {
                  const n = HEADLINE.slice(0, l).reduce((a, x) => a + x.length, 0) + i;
                  return (
                    <Fragment key={i}>
                      <span className={s.word} style={{ '--i': n } as React.CSSProperties}>
                        {HEADLINE_EMPHASIS.has(w) ? <em>{w}</em> : w}
                      </span>{i < line.length - 1 ? ' ' : null}
                    </Fragment>
                  );
                })}
              </span>
            ))}
          </h1>
          <p className={`${s.lede} ${s.enter}`} style={{ '--d': '520ms' } as React.CSSProperties}>
            Vehicles, drivers, containers, leases and buses, all on one live map and orchestrated by governed AI
            agents. See every move. Decide in seconds. Act with confidence.
          </p>
          <div className={`${s.actions} ${s.enter}`} style={{ '--d': '640ms' } as React.CSSProperties}>
            <Link className={`${s.btn} ${s.btnSolid}`} href="/operations-review" data-analytics-cta="hero_operations_review">
              Book an operations review <Arrow />
            </Link>
            <a className={s.btn} href="#platform" data-analytics-cta="hero_platform">Take the tour</a>
          </div>
          <div className={`${s.qualities} ${s.label} ${s.enter}`} style={{ '--d': '760ms' } as React.CSSProperties} aria-label="Platform qualities">
            <span>UAE / GCC ready</span><span>Multi-tenant isolation</span><span>Human-approved AI</span>
          </div>
        </div>

        <HeroStage stats={{ vehiclesLive: snapshot.vehiclesLive, fleetUtilization: snapshot.fleetUtilization, uptime: snapshot.uptime, isLive }} />
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
    <section className={`${s.wrap}`} id="platform" data-chapter="§ 01 Platform" aria-labelledby="platform-title" data-analytics-section="unified-platform">
      <div className={s.block}>
        <SectionHead index={1} name="Platform" id="platform-title"
          lede="Fleet360 connects vehicles, drivers, dispatch, maintenance, leasing, logistics, finance and compliance through one shared intelligence layer.">
          One platform. <em>Every</em> operation connected.
        </SectionHead>
        <div className={s.grid3}>
          {DOMAINS.map(([name, detail], i) => (
            <div className={s.cell} key={name} data-reveal="" style={{ '--d': `${(i % 3) * 70}ms` } as React.CSSProperties}><span className={s.label}>{pad(i + 1)}</span><h3>{name}</h3><p>{detail}</p></div>
          ))}
        </div>
        <div className={s.sequence} data-reveal="" aria-label="One event, every system informed">
          {EVENT_CHAIN.map((e, i) => <span key={e} className={i === 0 ? s.first : undefined}>{e}</span>)}
        </div>
      </div>
    </section>
  );
}

export function EditorialAgents() {
  return (
    <section className={s.wrap} id="agents" data-chapter="§ 02 AI agents" aria-labelledby="agents-title" data-analytics-section="ai-orchestration">
      <div className={s.block}>
        <SectionHead index={2} name="AI agents" id="agents-title">
          Specialized agents. <em>One</em> coordinated operation.
        </SectionHead>
        <div className={s.split}>
          <div data-reveal="">
            <p className={s.quote}>
              Agents detect risk, analyze context, recommend the next move and coordinate execution, with
              <em> people and policy</em> in control.
            </p>
            <div className={s.note}>
              <strong>Governed autonomy</strong>
              Every action follows permissions, approval thresholds and a complete audit trail.
            </div>
          </div>
          <div className={s.log} data-reveal="" style={{ '--d': '120ms' } as React.CSSProperties}>
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
        <div className={s.sequence} data-reveal="" aria-label="Agent decision sequence">
          {AGENT_STEPS.map((step, i) => <span key={step} className={i === 0 ? s.first : undefined}>{step}</span>)}
        </div>
      </div>
    </section>
  );
}

export function EditorialRegion() {
  return (
    <section className={s.wrap} id="region" data-chapter="§ 04 UAE / GCC" aria-labelledby="gcc-title" data-analytics-section="gcc-intelligence">
      <div className={s.block}>
        <SectionHead index={4} name="UAE / GCC" id="gcc-title"
          lede="Regional operating context in every decision, so vehicle records, permits, compliance and dispatch move together across borders and business units.">
          Built for the region. <em>Ready</em> for every authority.
        </SectionHead>
        <div className={s.grid3}>
          {REGION.map(([title, detail], i) => (
            <div className={s.cell} key={title} data-reveal="" style={{ '--d': `${(i % 3) * 70}ms` } as React.CSSProperties}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
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
    <section className={s.wrap} id="governed" data-chapter="§ 05 Governed AI" aria-labelledby="governed-title" data-analytics-section="governed-ai">
      <div className={s.block}>
        <SectionHead index={5} name="Governed AI" id="governed-title"
          lede="Least-privilege access, tenant-aware controls, explainable recommendations and a clear human decision boundary.">
          Intelligence with <em>accountability.</em>
        </SectionHead>
        <div className={s.grid3}>
          {CONTROLS.map(([title, detail], i) => (
            <div className={s.cell} key={title} data-reveal="" style={{ '--d': `${(i % 3) * 70}ms` } as React.CSSProperties}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function EditorialOutcomes({ snapshot }: { snapshot: HomepageSnapshot }) {
  const isLive = snapshot.source === 'configured';
  return (
    <section className={s.wrap} id="outcomes" data-chapter="§ 06 Outcomes" aria-labelledby="outcomes-title" data-analytics-section="operational-outcomes">
      <div className={s.block}>
        <SectionHead index={6} name="Outcomes" id="outcomes-title">
          Intelligence measured in <em>operational outcomes.</em>
        </SectionHead>
        <div className={s.numbers}>
          <div className={s.bigStat} data-reveal="">
            <strong aria-label={`minus ${snapshot.lowerOperatingCosts} percent`}><CountUp value={snapshot.lowerOperatingCosts} prefix="−" /><sup>%</sup></strong>
            <span>lower operating costs{isLive ? '' : ' (illustrative)'}</span>
          </div>
          <div className={s.grid2}>
            {OUTCOMES.map(([title, detail], i) => (
              <div className={s.cell} key={title} data-reveal="" style={{ '--d': `${(i % 3) * 70}ms` } as React.CSSProperties}><span className={s.label}>{pad(i + 1)}</span><h3>{title}</h3><p>{detail}</p></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  ['How long does a rollout take?', 'Rollout is phased. We start with one high-value workflow, such as dispatch or maintenance, then expand module by module. Your timeline is agreed during the operations review.'],
  ['Do we have to replace our current systems?', 'No. Fleet360 connects to telematics, ERP, accounting and authority systems through APIs and imports, so you can retire tools at your own pace.'],
  ['Where is our data hosted, and who can see it?', 'Each tenant is isolated, access is role-based and every action is audited. Hosting region is agreed with you to meet UAE and GCC data-residency requirements.'],
  ['Will the AI act without our approval?', 'Only inside the limits you set. Low-risk actions can run automatically; anything above your thresholds waits for an accountable person to approve it.'],
  ['Does it work in Arabic?', 'Yes. Records, documents and customer-facing screens are Arabic-ready, with right-to-left layouts where needed.'],
  ['How is Fleet360 priced?', 'By the modules and fleet size you use. The operations review ends with a written scope and quote, with no obligation.'],
];

export function EditorialFaq() {
  return (
    <section className={s.wrap} id="faq" data-chapter="§ 07 FAQ" aria-labelledby="faq-title" data-analytics-section="faq">
      <div className={s.block}>
        <SectionHead index={7} name="FAQ" id="faq-title" lede="The questions operations, IT and finance leaders ask before they start.">
          Straight <em>answers.</em>
        </SectionHead>
        <div className={s.faq}>
          {FAQ.map(([q, a], i) => (
            <details key={q} className={s.faqItem} data-reveal="" style={{ '--d': `${(i % 2) * 70}ms` } as React.CSSProperties}>
              <summary><span className={s.label}>{pad(i + 1)}</span>{q}<i aria-hidden="true" /></summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export const FAQ_ITEMS = FAQ;

export function EditorialClosing() {
  return (
    <div className={s.wrap}>
      <section className={s.cta} id="start" data-chapter="Get started" aria-labelledby="conversion-title" data-analytics-section="final-conversion" data-reveal="">
        <p className={`${s.kicker} ${s.label}`}>Operations review</p>
        <h2 id="conversion-title" className={s.head}>Make every moving part <em>move with intent.</em></h2>
        <p>Bring your operation into one intelligent command layer. We’ll map the first high-value workflow together.</p>
        <div className={s.actions}>
          <Link className={`${s.btn} ${s.btnSolid}`} href="/operations-review" data-analytics-cta="final_operations_review">
            Book an operations review <Arrow />
          </Link>
          <a className={s.btn} href="#platform" data-analytics-cta="final_platform">Take the tour again</a>
        </div>
      </section>
    </div>
  );
}

export function EditorialFooter() {
  return (
    <div className={s.wrap}>
      <footer className={s.footer}>
        <div className={s.footBrand}>
          <Link className={s.brand} href="/" aria-label="Fleet360 home">Fleet<b>360</b></Link>
          <p>AI-orchestrated fleet intelligence for operators across the UAE and GCC.</p>
        </div>
        <nav className={s.footCol} aria-label="Product">
          <span className={s.label}>Product</span>
          <a href="#platform">Platform</a><a href="#agents">AI agents</a><a href="#drayage">Live product</a><a href="#governed">Governed AI</a>
        </nav>
        <nav className={s.footCol} aria-label="Company">
          <span className={s.label}>Get started</span>
          <Link href="/operations-review">Operations review</Link><a href="#faq">FAQ</a><Link href="/login">Customer sign in</Link>
        </nav>
        <div className={`${s.footBase} ${s.label}`}>
          <span>© {new Date().getFullYear()} Fleet360</span>
          <span>Private by design · UAE / GCC ready · Built for operators</span>
        </div>
      </footer>
    </div>
  );
}

export const editorialPageClass = s.page;
export const skipLinkClass = s.skip;

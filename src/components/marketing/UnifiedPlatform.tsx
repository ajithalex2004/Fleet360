import styles from './UnifiedPlatform.module.css';

const domains = [
  ['Fleet & assets', 'vehicles · telematics'],
  ['Live dispatch', 'routes · capacity'],
  ['Maintenance', 'readiness · work orders'],
  ['Rental & leasing', 'contracts · yield'],
  ['Staff & school transport', 'people · safeguarding'],
  ['Logistics & exchange', 'shipments · partners'],
  ['Finance & VAT', 'costs · reconciliation'],
  ['Compliance & ESG', 'authority · reporting'],
];

export default function UnifiedPlatform() {
  return (
    <section className={styles.section} aria-labelledby="platform-title">
      <div className={styles.gridTexture} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>The unified operating system</p>
          <h2 id="platform-title">One platform.<br /><span>Every operation connected.</span></h2>
          <p className={styles.lede}>Fleet360 connects vehicles, drivers, dispatch, maintenance, leasing, logistics, finance, and compliance through one shared intelligence layer.</p>
          <div className={styles.note}><span aria-hidden="true">↗</span><div><strong>One event. Every system informed.</strong><small>A vehicle fault updates capacity, assigns a replacement, notifies the customer, and reconciles the cost—without duplicate work.</small></div></div>
        </div>

        <div className={styles.systemMap} aria-label="Fleet360 connected platform domains">
          <svg className={styles.connections} viewBox="0 0 720 620" aria-hidden="true">
            {domains.map((_, index) => {
              const angles = [-90, -45, 0, 45, 90, 135, 180, 225];
              const angle = angles[index] * Math.PI / 180;
              const x = 360 + Math.cos(angle) * 235;
              const y = 310 + Math.sin(angle) * 235;
              return <line key={index} x1="360" y1="310" x2={x} y2={y} />;
            })}
          </svg>
          <div className={styles.core}><span>FLEET360</span><strong>INTELLIGENCE CORE</strong><i /></div>
          {domains.map(([name, detail], index) => <div className={styles.domain} data-index={index} key={name}><b>{name}</b><small>{detail}</small></div>)}
        </div>
      </div>
      <div className={styles.eventRail} aria-label="Connected event example">
        <span className={styles.eventLabel}>One event · every system informed</span>
        {['Vehicle fault', 'Capacity updated', 'Replacement assigned', 'Customer notified', 'Cost reconciled'].map((item, index) => <div className={styles.event} key={item}><i className={index === 0 ? styles.alert : ''} /><strong>{item}</strong>{index < 4 && <span aria-hidden="true">→</span>}</div>)}
      </div>
    </section>
  );
}

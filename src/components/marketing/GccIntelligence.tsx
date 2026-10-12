import styles from './GccIntelligence.module.css';

const signals = [
  ['Authority workflows', 'Vehicle and permit readiness'],
  ['Regional operations', 'UAE · KSA · GCC context'],
  ['Local controls', 'Arabic-ready records and audit'],
];

export default function GccIntelligence() {
  return (
    <section className={styles.section} aria-labelledby="gcc-title">
      <div className={styles.map} aria-hidden="true"><div className={styles.gulf} /><span className={styles.markerDubai}>DXB</span><span className={styles.markerRiyadh}>RUH</span><span className={styles.markerDoha}>DOH</span><span className={styles.markerMuscat}>MCT</span><i className={styles.arcOne} /><i className={styles.arcTwo} /></div>
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>UAE / GCC operational intelligence</p>
          <h2 id="gcc-title">Built for the region.<br /><span>Ready for every authority.</span></h2>
          <p className={styles.lede}>Fleet360 brings regional operating context into every decision—so vehicle records, permits, compliance, and dispatch move together across borders and business units.</p>
          <div className={styles.tags}><span>UAE-ready</span><span>GCC-aware</span><span>Authority-oriented</span></div>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}><span>Regional command view</span><strong>LIVE / 04</strong></div>
          {signals.map(([title, detail], index) => <div className={styles.signal} key={title}><span className={styles.signalIndex}>0{index + 1}</span><div><b>{title}</b><small>{detail}</small></div><i className={index === 1 ? styles.amber : ''} /></div>)}
          <div className={styles.authority}><span className={styles.shield} aria-hidden="true">✓</span><div><strong>Authority workflow</strong><small>Permit renewal due · 14 days</small></div><span className={styles.arrow} aria-hidden="true">↗</span></div>
        </div>
      </div>
      <div className={styles.footer}><span>Dubai</span><i /><span>Riyadh</span><i /><span>Doha</span><i /><span>Muscat</span><strong>One operating signal across the GCC.</strong></div>
    </section>
  );
}

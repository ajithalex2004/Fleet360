import styles from './OperationalOutcomes.module.css';

const outcomes = [
  ['Availability', 'More vehicles ready', '01'],
  ['Response', 'Faster operational decisions', '02'],
  ['Resilience', 'Less unplanned downtime', '03'],
  ['Control', 'Stronger compliance and cost visibility', '04'],
];

export default function OperationalOutcomes() {
  return (
    <section className={styles.section} aria-labelledby="outcomes-title" data-analytics-section="operational-outcomes">
      <div className={styles.dusk} aria-hidden="true"><div className={styles.sun} /><div className={styles.mountains} /><div className={styles.route} /></div>
      <div className={styles.inner}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Operational outcomes</p>
          <h2 id="outcomes-title">Intelligence measured<br /><span>in operational outcomes.</span></h2>
          <p className={styles.lede}>Fleet360 turns connected data and AI-agent coordination into greater availability, faster response, stronger compliance, and tighter cost control.</p>
        </div>
        <div className={styles.outcomeGrid}>
          {outcomes.map(([title, detail, index]) => <article className={styles.outcome} key={title}><span>{index}</span><div className={styles.icon} aria-hidden="true" /><h3>{title}</h3><p>{detail}</p></article>)}
        </div>
      </div>
      <div className={styles.bottomLine}><span>From operational noise</span><i /><strong>to one clear decision.</strong></div>
    </section>
  );
}

import styles from './GovernedAi.module.css';

const controls = [
  ['01', 'Policy gate', 'Every recommendation is checked against role, tenant, and operating policy.'],
  ['02', 'Human approval', 'High-impact actions pause for accountable review before execution.'],
  ['03', 'Complete audit', 'Decisions, evidence, and outcomes remain traceable end to end.'],
];

export default function GovernedAi() {
  return (
    <section className={styles.section} aria-labelledby="governed-title" data-analytics-section="governed-ai">
      <div className={styles.scanlines} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>Security and governed AI</p>
          <h2 id="governed-title">Intelligence<br /><span>with accountability.</span></h2>
          <p className={styles.lede}>Fleet360 is designed for confident action: least-privilege access, tenant-aware controls, explainable recommendations, and a clear human decision boundary.</p>
          <div className={styles.badges}><span>Zero-trust by design</span><span>Policy-controlled agents</span></div>
        </div>
        <div className={styles.controlPanel}>
          <div className={styles.panelTop}><span>Governed autonomy</span><strong>CONTROL LAYER / ACTIVE</strong></div>
          <div className={styles.shield} aria-hidden="true"><div className={styles.shieldCore}>✓</div></div>
          <div className={styles.action}><span className={styles.actionDot} /><div><b>Suggested action</b><small>Reassign vehicle 392 to route E11</small></div><em>REVIEW</em></div>
          <div className={styles.connector} aria-hidden="true" />
          <div className={styles.controls}>{controls.map(([index, title, detail]) => <div className={styles.control} key={title}><span>{index}</span><div><b>{title}</b><small>{detail}</small></div><i /></div>)}</div>
        </div>
      </div>
      <div className={styles.footer}><span>Detect</span><i /><span>Explain</span><i /><span>Approve</span><i /><span>Act</span><strong>Trust is part of the system.</strong></div>
    </section>
  );
}

import styles from './AgentOrchestration.module.css';

const agents = [
  { name: 'Dispatch', detail: 'capacity + route intent', tone: 'lime' },
  { name: 'Maintenance', detail: 'predictive readiness', tone: 'gold' },
  { name: 'Safety', detail: 'risk + escalation', tone: 'orange' },
  { name: 'Finance', detail: 'cost-to-serve signals', tone: 'blue' },
  { name: 'Compliance', detail: 'authority workflows', tone: 'violet' },
  { name: 'Customer ops', detail: 'service continuity', tone: 'cyan' },
];

export default function AgentOrchestration() {
  return (
    <section className={styles.section} aria-labelledby="agents-title" data-analytics-section="ai-orchestration">
      <div className={styles.ambient} aria-hidden="true" />
      <div className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>The agentic operating layer</p>
          <h2 id="agents-title">Specialized AI agents.<br /><span>One coordinated operation.</span></h2>
          <p className={styles.lede}>
            Fleet360 agents detect risk, analyze context, recommend the next move, and coordinate execution across your operation—with people and policy in control.
          </p>
          <div className={styles.governance}>
            <span className={styles.governanceIcon} aria-hidden="true">◈</span>
            <div><strong>Governed autonomy</strong><small>Every action follows permissions, approval thresholds, and a complete audit trail.</small></div>
          </div>
        </div>

        <div className={styles.orbit} aria-label="Fleet360 AI agent orchestration diagram">
          <div className={styles.ring} aria-hidden="true" />
          <div className={styles.core}><span>FLEET360</span><strong>ORCHESTRATOR</strong><i /></div>
          {agents.map((agent, index) => (
            <div className={`${styles.agent} ${styles[agent.tone]}`} data-position={index} key={agent.name}>
              <b>{agent.name}</b><small>{agent.detail}</small>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.sequence} aria-label="Agent decision sequence">
        {['Detect', 'Analyze', 'Recommend', 'Approve', 'Act', 'Learn'].map((step, index) => (
          <div key={step} className={styles.step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></div>
        ))}
      </div>
    </section>
  );
}

import Link from 'next/link';
import styles from './FinalConversion.module.css';

const Arrow = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M14 7l5 5-5 5" /></svg>;

export default function FinalConversion() {
  return (
    <section className={styles.section} aria-labelledby="conversion-title">
      <div className={styles.light} aria-hidden="true" /><div className={styles.lines} aria-hidden="true" />
      <div className={styles.inner}>
        <p className={styles.eyebrow}>The next operational signal</p>
        <h2 id="conversion-title">Make every moving part<br /><span>move with intent.</span></h2>
        <p className={styles.lede}>Bring your operation into one intelligent command layer. We’ll map the first high-value workflow together.</p>
        <div className={styles.actions}><Link className={styles.primary} href="/operations-review">Book an operations review <Arrow /></Link><Link className={styles.secondary} href="/platform">Explore Fleet360 <Arrow /></Link></div>
        <div className={styles.assurance}><span>Private by design</span><i /><span>UAE / GCC ready</span><i /><span>Built for operators</span></div>
      </div>
      <footer className={styles.footer}><span className={styles.brand}>FLEET<strong>360</strong></span><span>AI-orchestrated fleet intelligence</span><Link href="/login">Sign in <Arrow /></Link></footer>
    </section>
  );
}

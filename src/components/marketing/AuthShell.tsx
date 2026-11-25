import type { ReactNode } from 'react';
import Link from 'next/link';
import { carlito } from './editorial/font';
import styles from './AuthShell.module.css';

export { styles as authStyles };

/**
 * Page frame for the public auth screens (login, forgot/reset password) in the
 * editorial homepage style (Calibri, paper + ink, orange accent). `identity`
 * replaces the default eyebrow above the card, e.g. with a tenant's
 * white-label logo.
 */
export default function AuthShell({
  children,
  identity,
  eyebrow = 'Fleet management platform',
  footer = 'Fleet360 · Multi-tenant platform',
  dir,
}: {
  children: ReactNode;
  identity?: ReactNode;
  eyebrow?: string;
  footer?: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <div className={`${styles.page} ${carlito.variable}`} dir={dir}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Fleet360 home">Fleet<b>360</b></Link>
        <Link className={styles.back} href="/"><span aria-hidden="true">←</span> Back to overview</Link>
      </header>
      <main className={styles.main}>
        <aside className={styles.aside} aria-hidden="true">
          <p className={styles.kicker}>AI-orchestrated fleet intelligence · UAE &amp; GCC</p>
          <p className={styles.display}>Connect your fleet. <span className={styles.displaySub}>Transform it into AI-driven <em>Smart Mobility</em></span></p>
          <p className={styles.asideLede}>
            Vehicles, drivers, bookings and maintenance on one live map, orchestrated by governed AI agents.
          </p>
          <div className={styles.qualities}>
            <span>UAE / GCC ready</span><span>Multi-tenant isolation</span><span>Human-approved AI</span>
          </div>
        </aside>
        <div className={styles.column}>
          <div className={styles.identity}>
            {identity}
            <p className={styles.eyebrow}>{eyebrow}</p>
          </div>
          <div className={styles.card}>{children}</div>
          <p className={styles.footer}>{footer}</p>
        </div>
      </main>
    </div>
  );
}

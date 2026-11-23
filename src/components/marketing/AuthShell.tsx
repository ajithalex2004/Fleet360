import type { ReactNode } from 'react';
import Link from 'next/link';
import styles from './AuthShell.module.css';

export { styles as authStyles };

/**
 * Page frame for the public auth screens (login, forgot/reset password) in the
 * homepage theme. `identity` replaces the default eyebrow above the card, e.g.
 * with a tenant's white-label logo.
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
    <div className={styles.page} dir={dir}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Fleet360 home">
          <span>FLEET</span><strong>360</strong>
        </Link>
        <Link className={styles.back} href="/">Back to overview <span aria-hidden="true">←</span></Link>
      </header>
      <main className={styles.main}>
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

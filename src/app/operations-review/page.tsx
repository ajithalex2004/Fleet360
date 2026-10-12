import type { Metadata } from 'next';
import Link from 'next/link';
import ReviewRequestForm from './review-request-form';
import styles from './review-request.module.css';

export const metadata: Metadata = {
  title: 'Book an operations review',
  description: 'Arrange a Fleet360 operations review for your fleet, transport, and compliance workflows.',
  openGraph: {
    title: 'Book a Fleet360 operations review',
    description: 'Bring your fleet operation into one AI-orchestrated command layer.',
  },
  twitter: {
    card: 'summary',
    title: 'Book a Fleet360 operations review',
    description: 'Bring your fleet operation into one AI-orchestrated command layer.',
  },
};

export default function OperationsReviewPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Fleet360 home">
          <span>FLEET</span><strong>360</strong>
        </Link>
        <Link className={styles.back} href="/">Back to overview <span aria-hidden="true">←</span></Link>
      </header>

      <section className={styles.content} aria-labelledby="review-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Operations review</p>
          <h1 id="review-title">Start with the operation you have. Leave with a clearer command path.</h1>
          <p>
            Tell us how your fleet is moving today. Our team will use this context to shape a focused Fleet360 review around your vehicles, people, routes, maintenance, finance, and compliance.
          </p>
          <ul>
            <li>Map the systems and decisions that are currently disconnected.</li>
            <li>Identify where governed AI agents can remove operational drag.</li>
            <li>Agree the next practical step for your organisation.</li>
          </ul>
        </div>
        <ReviewRequestForm />
      </section>
    </main>
  );
}

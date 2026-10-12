'use client';

import { FormEvent, useState } from 'react';
import styles from './review-request.module.css';
import { trackReviewRequestSubmitted } from '@/components/marketing/HomepageAnalytics';

type FormStatus = 'idle' | 'submitting' | 'success' | 'error';

const initialValues = {
  name: '',
  workEmail: '',
  company: '',
  fleetSize: '',
  message: '',
  website: '',
};

export default function ReviewRequestForm() {
  const [values, setValues] = useState(initialValues);
  const [status, setStatus] = useState<FormStatus>('idle');
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('submitting');
    setMessage('');

    try {
      const response = await fetch('/api/public/operations-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) throw new Error(body.error || 'We could not send your request. Please try again.');

      setStatus('success');
      trackReviewRequestSubmitted();
      setMessage('Your review request is with the Fleet360 operations team. We will be in touch using your work email.');
      setValues(initialValues);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'We could not send your request. Please try again.');
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} aria-describedby="form-status">
      <div className={styles.formHeading}>
        <p>Request a review</p>
        <span>Fields marked * are required</span>
      </div>

      <div className={styles.fieldGrid}>
        <label>
          <span>Name *</span>
          <input
            autoComplete="name"
            name="name"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            required
            maxLength={100}
          />
        </label>
        <label>
          <span>Work email *</span>
          <input
            autoComplete="email"
            name="workEmail"
            type="email"
            value={values.workEmail}
            onChange={(event) => setValues({ ...values, workEmail: event.target.value })}
            required
            maxLength={254}
          />
        </label>
        <label>
          <span>Company *</span>
          <input
            autoComplete="organization"
            name="company"
            value={values.company}
            onChange={(event) => setValues({ ...values, company: event.target.value })}
            required
            maxLength={160}
          />
        </label>
        <label>
          <span>Fleet size</span>
          <select
            name="fleetSize"
            value={values.fleetSize}
            onChange={(event) => setValues({ ...values, fleetSize: event.target.value })}
          >
            <option value="">Select range</option>
            <option value="1–25">1–25 vehicles</option>
            <option value="26–100">26–100 vehicles</option>
            <option value="101–500">101–500 vehicles</option>
            <option value="501+">501+ vehicles</option>
          </select>
        </label>
      </div>

      <label className={styles.messageField}>
        <span>What would you like to improve?</span>
        <textarea
          name="message"
          value={values.message}
          onChange={(event) => setValues({ ...values, message: event.target.value })}
          rows={4}
          maxLength={2_000}
          placeholder="For example: dispatch visibility, maintenance downtime, authority workflows, or cost control."
        />
      </label>

      <label className={styles.honeypot} aria-hidden="true">
        <span>Website</span>
        <input
          tabIndex={-1}
          autoComplete="off"
          name="website"
          value={values.website}
          onChange={(event) => setValues({ ...values, website: event.target.value })}
        />
      </label>

      <button type="submit" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Sending request…' : 'Request an operations review'}
        <span aria-hidden="true">→</span>
      </button>
      <p id="form-status" className={status === 'error' ? styles.error : styles.status} role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}

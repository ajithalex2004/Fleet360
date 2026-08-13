/**
 * Predictive-maintenance engine is owned by the AI Platform.
 * Canonical location: /ai-platform/predictive
 * Maintenance retains a read-only consumer view at /maintenance/predictive-alerts.
 */
import { redirect } from 'next/navigation';

export default function PredictiveEngineRedirect() {
  redirect('/ai-platform/predictive');
}

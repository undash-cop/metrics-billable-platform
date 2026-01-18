import { Env } from '../types/env.js';
import { handleEvents } from './events.js';
import { createObservabilityContext, trackOperation } from '../middleware/observability.js';
import { randomUUID } from '../utils/crypto.js';

/**
 * Observable Events Handler
 * 
 * Wraps the events handler with observability (logging, metrics, alerts).
 * This is an example of how to integrate observability into existing handlers.
 */

export async function handleEventsObservable(
  request: Request,
  env: Env
): Promise<Response> {
  const requestId = request.headers.get('X-Request-ID') || randomUUID();
  const obs = createObservabilityContext(env, requestId);

  return await trackOperation(
    obs,
    'event_ingestion',
    {
      method: request.method,
      path: new URL(request.url).pathname,
    },
    async () => {
      const startTime = Date.now();

      try {
        const response = await handleEvents(request, env);
        const duration = Date.now() - startTime;

        // Track metrics
        const statusCode = response.status;
        const success = statusCode >= 200 && statusCode < 300;

        obs.metrics.trackEventIngestion(success, duration, {
          statusCode: String(statusCode),
        });

        obs.metrics.trackApiRequest(
          '/events',
          request.method,
          statusCode,
          duration
        );

        // Check for alerts
        if (!success) {
          obs.metrics.increment('events.ingestion.failed');
          const alert = obs.alerts.checkThreshold('events.ingestion.failed', 1);
          if (alert) {
            obs.logger.error('Alert triggered', {
              alertId: alert.id,
              severity: alert.severity,
              metric: alert.metric,
            });
          }
        }

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;

        obs.metrics.trackEventIngestion(false, duration);
        obs.metrics.increment('events.ingestion.failed');

        // Check alert threshold
        const alert = obs.alerts.checkThreshold('events.ingestion.failed', 1);
        if (alert) {
          obs.logger.error('Alert triggered', {
            alertId: alert.id,
            severity: alert.severity,
            metric: alert.metric,
          });
        }

        throw error;
      }
    }
  );
}

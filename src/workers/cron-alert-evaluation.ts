import { Env } from '../types/env.js';
import { createRdsPool } from '../db/rds.js';
import { createLogger } from '../utils/logger.js';
import { createMetricsCollector } from '../utils/metrics.js';
import {
  getAlertRulesByOrganisation,
  evaluateAlertRule,
  createAlertHistory,
  updateAlertHistoryStatus,
} from '../services/usage-alerts.js';
import { sendAlertNotification } from '../services/alert-notifications.js';
import { DatabaseError } from '../utils/errors.js';

/**
 * Cloudflare Worker Cron Job: Alert Evaluation
 * 
 * Purpose: Periodically evaluate all active alert rules and trigger notifications.
 * 
 * Schedule: Runs every hour (`0 * * * *`)
 * 
 * Design Decisions:
 * 1. Evaluates all active alert rules
 * 2. Respects cooldown periods
 * 3. Creates alert history records
 * 4. Sends notifications via configured channels
 * 5. Continues processing other alerts if one fails
 * 6. Comprehensive logging and metrics
 */

interface EvaluationStats {
  totalRules: number;
  evaluated: number;
  triggered: number;
  sent: number;
  failed: number;
  skipped: number; // Skipped due to cooldown or inactive
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(env);
    const metrics = createMetricsCollector();
    const pool = createRdsPool(env);

    const startTime = Date.now();
    const stats: EvaluationStats = {
      totalRules: 0,
      evaluated: 0,
      triggered: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
    };

    try {
      logger.info('Starting alert evaluation cron job', {
        cron: event.cron,
        scheduledTime: new Date(event.scheduledTime).toISOString(),
      });

      // Get all active alert rules (across all organisations)
      // We'll process them organisation by organisation for better organization
      const organisationsResult = await pool.query<{ id: string }>(
        `SELECT DISTINCT organisation_id as id
         FROM alert_rules
         WHERE is_active = true`
      );

      const organisationIds = organisationsResult.rows.map((row) => row.id);
      logger.info(`Found ${organisationIds.length} organisations with active alert rules`);

      for (const organisationId of organisationIds) {
        try {
          // Get active alert rules for this organisation
          const rules = await getAlertRulesByOrganisation(pool, organisationId, {
            isActive: true,
          });

          stats.totalRules += rules.length;

          logger.info(`Evaluating ${rules.length} alert rules for organisation`, {
            organisationId,
            ruleCount: rules.length,
          });

          for (const rule of rules) {
            try {
              stats.evaluated++;

              // Evaluate alert rule
              const evaluationResult = await evaluateAlertRule(pool, env, rule);

              if (!evaluationResult || !evaluationResult.triggered) {
                stats.skipped++;
                continue; // Alert not triggered
              }

              stats.triggered++;

              logger.info('Alert rule triggered', {
                ruleId: rule.id,
                ruleName: rule.name,
                organisationId: rule.organisationId,
                alertType: rule.alertType,
                actualValue: evaluationResult.actualValue,
                thresholdValue: evaluationResult.thresholdValue,
              });

              // Create alert history record
              const alertHistory = await createAlertHistory(
                pool,
                rule,
                evaluationResult
              );

              // Send notifications
              try {
                await sendAlertNotification(pool, env, rule, alertHistory, evaluationResult);
                await updateAlertHistoryStatus(pool, alertHistory.id, 'sent');
                stats.sent++;

                logger.info('Alert notification sent successfully', {
                  alertId: alertHistory.id,
                  ruleId: rule.id,
                  channels: rule.notificationChannels,
                });
              } catch (notificationError) {
                stats.failed++;
                const errorMessage =
                  notificationError instanceof Error
                    ? notificationError.message
                    : String(notificationError);

                await updateAlertHistoryStatus(pool, alertHistory.id, 'failed', {
                  errorMessage,
                });

                logger.error('Failed to send alert notification', {
                  alertId: alertHistory.id,
                  ruleId: rule.id,
                  error: errorMessage,
                });
              }
            } catch (ruleError) {
              stats.failed++;
              logger.error('Error evaluating alert rule', {
                ruleId: rule.id,
                organisationId: rule.organisationId,
                error: ruleError instanceof Error ? ruleError.message : String(ruleError),
                stack: ruleError instanceof Error ? ruleError.stack : undefined,
              });
              // Continue with next rule
            }
          }
        } catch (orgError) {
          logger.error('Error processing organisation alert rules', {
            organisationId,
            error: orgError instanceof Error ? orgError.message : String(orgError),
          });
          // Continue with next organisation
        }
      }

      const duration = Date.now() - startTime;

      logger.info('Alert evaluation cron job completed', {
        totalRules: stats.totalRules,
        evaluated: stats.evaluated,
        triggered: stats.triggered,
        sent: stats.sent,
        failed: stats.failed,
        skipped: stats.skipped,
        durationMs: duration,
      });

      // Emit metrics
      metrics.gauge('alerts.evaluation.total_rules', stats.totalRules);
      metrics.gauge('alerts.evaluation.evaluated', stats.evaluated);
      metrics.gauge('alerts.evaluation.triggered', stats.triggered);
      metrics.gauge('alerts.evaluation.sent', stats.sent);
      metrics.gauge('alerts.evaluation.failed', stats.failed);
      metrics.gauge('alerts.evaluation.skipped', stats.skipped);
      metrics.gauge('alerts.evaluation.duration_ms', duration);

      // Alert if failure rate is high
      if (stats.failed > 0 && stats.evaluated > 0) {
        const failureRate = stats.failed / stats.evaluated;
        if (failureRate > 0.1) {
          // More than 10% failure rate
          logger.error('High alert evaluation failure rate detected', {
            failed: stats.failed,
            evaluated: stats.evaluated,
            failureRate: failureRate.toFixed(2),
          });
          // TODO: Trigger an actual alert via alert service
        }
      }
    } catch (error) {
      logger.fatal('Fatal error in alert evaluation cron job', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        cron: event.cron,
      });
      metrics.increment('alerts.evaluation.cron.fatal_error');
      // Re-throw to ensure Cloudflare knows the cron failed
      throw error;
    } finally {
      await pool.end(); // Close the RDS pool connection
    }
  },
};

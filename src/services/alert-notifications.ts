import pg from 'pg';
import { Env } from '../types/env.js';
import { AlertRule, AlertHistory, AlertEvaluationResult } from './usage-alerts.js';
import { sendEmail } from './email-service.js';
import { createLogger } from '../utils/logger.js';
import { queryRds } from '../db/rds.js';

/**
 * Alert Notification Service
 * 
 * Handles sending alert notifications via various channels:
 * - Email
 * - SMS (TODO: implement)
 * - Webhook
 */

/**
 * Send alert notification via configured channels
 */
export async function sendAlertNotification(
  pool: pg.Pool,
  env: Env,
  rule: AlertRule,
  alertHistory: AlertHistory,
  evaluationResult: AlertEvaluationResult
): Promise<void> {
  const logger = createLogger(env);

  // Get organisation billing email
  const orgResult = await queryRds<{ billing_email: string | null; name: string }>(
    pool,
    `SELECT billing_email, name FROM organisations WHERE id = $1`,
    [rule.organisationId]
  );

  if (orgResult.rows.length === 0) {
    throw new Error(`Organisation not found: ${rule.organisationId}`);
  }

  const organisation = orgResult.rows[0];

  // Send notifications via each configured channel
  const notificationPromises: Promise<void>[] = [];

  for (const channel of rule.notificationChannels) {
    switch (channel) {
      case 'email':
        if (organisation.billing_email) {
          notificationPromises.push(
            sendAlertEmail(env, organisation.billing_email, organisation.name, rule, alertHistory, evaluationResult)
          );
        } else {
          logger.warn('No billing email configured for organisation', {
            organisationId: rule.organisationId,
            ruleId: rule.id,
          });
        }
        break;

      case 'webhook':
        if (rule.webhookUrl) {
          notificationPromises.push(
            sendAlertWebhook(env, rule.webhookUrl, rule, alertHistory, evaluationResult)
          );
        } else {
          logger.warn('Webhook channel configured but no webhook URL provided', {
            ruleId: rule.id,
          });
        }
        break;

      case 'sms':
        // TODO: Implement SMS notification
        logger.warn('SMS notifications not yet implemented', {
          ruleId: rule.id,
        });
        break;

      default:
        logger.warn('Unknown notification channel', {
          channel,
          ruleId: rule.id,
        });
    }
  }

  // Wait for all notifications to complete
  await Promise.allSettled(notificationPromises);
}

/**
 * Send alert email
 */
async function sendAlertEmail(
  env: Env,
  recipient: string,
  organisationName: string,
  rule: AlertRule,
  alertHistory: AlertHistory,
  evaluationResult: AlertEvaluationResult
): Promise<void> {
  const logger = createLogger(env);

  // Generate email subject
  const subject = `Alert: ${rule.name} - ${rule.alertType}`;

  // Generate email HTML
  const html = generateAlertEmailHtml(
    organisationName,
    rule,
    alertHistory,
    evaluationResult
  );

  try {
    const emailResult = await sendEmail(env, {
      to: recipient,
      subject,
      html,
      metadata: {
        alertId: alertHistory.id,
        ruleId: rule.id,
        organisationId: rule.organisationId,
        alertType: rule.alertType,
      },
    });

    if (emailResult.success) {
      logger.info('Alert email sent successfully', {
        alertId: alertHistory.id,
        recipient,
        messageId: emailResult.messageId,
      });
    } else {
      throw new Error(emailResult.error || 'Failed to send alert email');
    }
  } catch (error) {
    logger.error('Failed to send alert email', {
      alertId: alertHistory.id,
      recipient,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Send alert webhook
 */
async function sendAlertWebhook(
  env: Env,
  webhookUrl: string,
  rule: AlertRule,
  alertHistory: AlertHistory,
  evaluationResult: AlertEvaluationResult
): Promise<void> {
  const logger = createLogger(env);

  const payload = {
    alert: {
      id: alertHistory.id,
      ruleId: rule.id,
      ruleName: rule.name,
      alertType: rule.alertType,
      organisationId: rule.organisationId,
      projectId: rule.projectId,
      metricName: rule.metricName,
      unit: rule.unit,
      thresholdValue: rule.thresholdValue,
      actualValue: evaluationResult.actualValue,
      comparisonValue: evaluationResult.comparisonValue,
      spikePercentage: evaluationResult.spikePercentage,
      periodStart: evaluationResult.periodStart.toISOString(),
      periodEnd: evaluationResult.periodEnd.toISOString(),
      triggeredAt: alertHistory.createdAt.toISOString(),
      metadata: alertHistory.metadata,
    },
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Metrics-Billing-Platform/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook returned ${response.status}: ${errorText}`);
    }

    logger.info('Alert webhook sent successfully', {
      alertId: alertHistory.id,
      webhookUrl,
      statusCode: response.status,
    });
  } catch (error) {
    logger.error('Failed to send alert webhook', {
      alertId: alertHistory.id,
      webhookUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Generate alert email HTML
 */
function generateAlertEmailHtml(
  organisationName: string,
  rule: AlertRule,
  alertHistory: AlertHistory,
  evaluationResult: AlertEvaluationResult
): string {
  const alertTypeLabels: Record<string, string> = {
    usage_threshold: 'Usage Threshold Alert',
    usage_spike: 'Usage Spike Alert',
    cost_threshold: 'Cost Threshold Alert',
    unusual_pattern: 'Unusual Pattern Alert',
  };

  const operatorLabels: Record<string, string> = {
    gt: 'greater than',
    gte: 'greater than or equal to',
    lt: 'less than',
    lte: 'less than or equal to',
    eq: 'equal to',
  };

  const periodLabels: Record<string, string> = {
    hour: 'Last Hour',
    day: 'Today',
    week: 'This Week',
    month: 'This Month',
  };

  const alertTypeLabel = alertTypeLabels[rule.alertType] || rule.alertType;
  const operatorLabel = operatorLabels[rule.thresholdOperator] || rule.thresholdOperator;
  const periodLabel = periodLabels[rule.comparisonPeriod] || rule.comparisonPeriod;

  let alertDetails = '';

  if (rule.alertType === 'usage_spike' && evaluationResult.spikePercentage !== undefined) {
    alertDetails = `
      <tr>
        <td><strong>Spike Percentage:</strong></td>
        <td>${evaluationResult.spikePercentage.toFixed(2)}%</td>
      </tr>
      <tr>
        <td><strong>Comparison Value:</strong></td>
        <td>${evaluationResult.comparisonValue || 'N/A'}</td>
      </tr>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${alertTypeLabel}</title>
      <style>
        body {
          font-family: 'Helvetica Neue', 'Helvetica', Arial, sans-serif;
          margin: 0;
          padding: 20px;
          color: #333;
          line-height: 1.6;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: #fff;
          padding: 30px;
          border: 1px solid #eee;
          border-radius: 8px;
        }
        .header {
          border-bottom: 2px solid #f0f0f0;
          padding-bottom: 20px;
          margin-bottom: 20px;
        }
        .header h1 {
          color: #e74c3c;
          margin: 0;
          font-size: 24px;
        }
        .alert-info {
          background: #fff3cd;
          border-left: 4px solid #ffc107;
          padding: 15px;
          margin: 20px 0;
          border-radius: 4px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        table td {
          padding: 10px;
          border-bottom: 1px solid #eee;
        }
        table td:first-child {
          font-weight: 600;
          width: 40%;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
          color: #777;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>⚠️ ${alertTypeLabel}</h1>
        </div>

        <div class="alert-info">
          <strong>Alert Rule:</strong> ${rule.name}<br>
          ${rule.description ? `<strong>Description:</strong> ${rule.description}<br>` : ''}
          <strong>Triggered At:</strong> ${new Date(alertHistory.createdAt).toLocaleString()}
        </div>

        <table>
          <tr>
            <td><strong>Organisation:</strong></td>
            <td>${organisationName}</td>
          </tr>
          ${rule.projectId ? `
          <tr>
            <td><strong>Project:</strong></td>
            <td>${rule.projectId}</td>
          </tr>
          ` : ''}
          <tr>
            <td><strong>Alert Type:</strong></td>
            <td>${alertTypeLabel}</td>
          </tr>
          ${rule.metricName ? `
          <tr>
            <td><strong>Metric:</strong></td>
            <td>${rule.metricName} (${rule.unit || 'N/A'})</td>
          </tr>
          ` : ''}
          <tr>
            <td><strong>Period:</strong></td>
            <td>${periodLabel}</td>
          </tr>
          <tr>
            <td><strong>Threshold:</strong></td>
            <td>${operatorLabel} ${rule.thresholdValue}</td>
          </tr>
          <tr>
            <td><strong>Actual Value:</strong></td>
            <td><strong style="color: #e74c3c;">${evaluationResult.actualValue}</strong></td>
          </tr>
          ${alertDetails}
        </table>

        <div class="footer">
          <p>This is an automated alert from the Metrics Billing Platform.</p>
          <p>To manage your alert rules, please visit the admin dashboard.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

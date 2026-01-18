#!/usr/bin/env node
/**
 * Example: Ingest Usage Events
 * 
 * Demonstrates how to ingest usage events into the billing platform.
 * 
 * Usage:
 *   node examples/ingest-events.js <project-api-key> <count>
 * 
 * Example:
 *   node examples/ingest-events.js sk_abc123 100
 */

const API_KEY = process.argv[2];
const EVENT_COUNT = parseInt(process.argv[3] || '10', 10);
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';

if (!API_KEY) {
  console.error('Usage: node examples/ingest-events.js <project-api-key> [count]');
  process.exit(1);
}

async function ingestEvent(eventId, metricName, metricValue, unit) {
  const response = await fetch(`${BASE_URL}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_id: eventId,
      metric_name: metricName,
      metric_value: metricValue,
      unit: unit,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to ingest event: ${error.error}`);
  }

  return await response.json();
}

async function main() {
  console.log(`Ingesting ${EVENT_COUNT} events...`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log('');

  const results = {
    success: 0,
    failed: 0,
    duplicates: 0,
  };

  for (let i = 0; i < EVENT_COUNT; i++) {
    const eventId = `test-event-${Date.now()}-${i}`;
    
    try {
      const result = await ingestEvent(
        eventId,
        'api_calls',
        1,
        'count'
      );

      if (result.status === 'duplicate') {
        results.duplicates++;
        console.log(`[${i + 1}/${EVENT_COUNT}] Duplicate: ${eventId}`);
      } else {
        results.success++;
        if ((i + 1) % 10 === 0) {
          console.log(`[${i + 1}/${EVENT_COUNT}] Ingested: ${eventId}`);
        }
      }
    } catch (error) {
      results.failed++;
      console.error(`[${i + 1}/${EVENT_COUNT}] Failed: ${error.message}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log('');
  console.log('Results:');
  console.log(`  Success: ${results.success}`);
  console.log(`  Duplicates: ${results.duplicates}`);
  console.log(`  Failed: ${results.failed}`);
}

main().catch(console.error);

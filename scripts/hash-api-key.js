#!/usr/bin/env node
/**
 * Hash API Key Utility
 * 
 * Generates SHA-256 hash of an API key for storage in database.
 * 
 * Usage:
 *   node scripts/hash-api-key.js "your-api-key-here"
 */

import crypto from 'crypto';

const apiKey = process.argv[2];

if (!apiKey) {
  console.error('Usage: node scripts/hash-api-key.js "your-api-key-here"');
  process.exit(1);
}

// Generate SHA-256 hash
const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

console.log('API Key Hash (SHA-256):');
console.log(hash);
console.log('');
console.log('SQL to insert:');
console.log(`INSERT INTO admin_api_keys (user_id, key_hash, name, expires_at, is_active)`);
console.log(`VALUES (`);
console.log(`  'user-uuid-here',`);
console.log(`  '${hash}',`);
console.log(`  'API Key Name',`);
console.log(`  NULL,`);
console.log(`  true`);
console.log(`);`);

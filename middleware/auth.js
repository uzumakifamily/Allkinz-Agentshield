'use strict';
/**
 * middleware/auth.js — API key validation for Fastify preHandler
 *
 * Key format:  sk_live_<64 hex chars>   (total: 72 chars)
 * Stored:      key_prefix = first 16 chars, key_hash = SHA-256(full key)
 * Lookup:      by prefix (indexed) → compare hash → attach workspaceId to req
 */

const crypto  = require('crypto');
const { getDb } = require('../db');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function authMiddleware(request, reply) {
  const authHeader = request.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing Authorization header' });
    return;
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith('sk_live_') || rawKey.length < 40) {
    reply.code(401).send({ error: 'Invalid API key format. Expected: sk_live_<hex>' });
    return;
  }

  const prefix = rawKey.substring(0, 16);   // 'sk_live_' + 8 chars
  const hash   = hashKey(rawKey);

  const db = getDb();
  try {
    const row = db.prepare(
      `SELECT workspace_id FROM api_keys
        WHERE key_prefix = ? AND key_hash = ? AND revoked_at IS NULL`
    ).get(prefix, hash);

    if (!row) {
      reply.code(401).send({ error: 'Invalid or revoked API key' });
      return;
    }

    request.workspaceId = row.workspace_id;

    // Update last_used_at without blocking the request
    setImmediate(() => {
      const db2 = getDb();
      try {
        db2.prepare(
          `UPDATE api_keys SET last_used_at = datetime('now') WHERE key_prefix = ?`
        ).run(prefix);
      } finally { db2.close(); }
    });
  } finally {
    db.close();
  }
}

module.exports = { authMiddleware, hashKey };

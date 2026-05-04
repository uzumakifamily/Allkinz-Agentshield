'use strict';
/**
 * server.js — AgentShield Core (self-hosted)
 *
 * Fastify HTTP server — no auth, no dashboard, single-tenant.
 * Secure at the network level (firewall, VPN, or reverse proxy with auth).
 *
 * Routes:
 *   GET  /health
 *   POST /api/actions           — evaluate an agent action
 *   GET  /api/actions           — action history
 *   GET  /api/audit             — paginated audit log
 *   GET  /api/audit/export      — CSV export
 *   GET  /api/rules             — list policy rules
 *   POST /api/rules             — create rule
 *   PATCH/DELETE /api/rules/:id — update/delete rule
 *   GET  /api/approvals         — pending approval queue
 *   POST /api/approvals/:id/resolve — approve/deny action
 *   POST /webhooks/:workspaceId — no-code platform ingestion (n8n, Zapier, Make)
 */

require('dotenv').config();
const shieldKernel = require('./core/shield_kernel');
const fastify      = require('fastify')({ logger: true });

const PORT = process.env.PORT || 3000;

// ── CORS + Security headers ────────────────────────────────────
fastify.addHook('onRequest', async (request, reply) => {
  const origin  = request.headers.origin || '';
  const allowed = process.env.CORS_ORIGIN || '*';
  reply.header('Access-Control-Allow-Origin',  allowed);
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (request.method === 'OPTIONS') return reply.code(204).send();

  reply.header('X-Content-Type-Options',   'nosniff');
  reply.header('X-Frame-Options',          'DENY');
  reply.header('X-XSS-Protection',         '1; mode=block');
  reply.header('Referrer-Policy',          'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy',       'camera=(), microphone=(), geolocation=()');
  if (origin.startsWith('https://')) {
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
});

// ── Rate limiter — /api/actions: 100 req/hr per IP ────────────
const _actionsMap       = new Map();
const ACTIONS_MAX       = 100;
const ACTIONS_WINDOW_MS = 60 * 60 * 1000;

function checkIpRateLimit(map, ip, max, windowMs) {
  const now = Date.now();
  const e   = map.get(ip);
  if (!e || now > e.resetAt) { map.set(ip, { count: 1, resetAt: now + windowMs }); return { ok: true }; }
  if (e.count >= max)         return { ok: false, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  e.count += 1;
  return { ok: true };
}

fastify.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/actions')) return;
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || 'unknown';
  const rl = checkIpRateLimit(_actionsMap, ip, ACTIONS_MAX, ACTIONS_WINDOW_MS);
  if (!rl.ok) {
    reply.code(429).send({ error: 'Rate limit exceeded. Max 100 requests per hour per IP.', retryAfterSeconds: rl.retryAfter });
  }
});

// ── Routes ─────────────────────────────────────────────────────
fastify.register(require('./api/health'),    { prefix: '/health'        });
fastify.register(require('./api/actions'),   { prefix: '/api/actions'   });
fastify.register(require('./api/audit'),     { prefix: '/api/audit'     });
fastify.register(require('./api/rules'),     { prefix: '/api/rules'     });
fastify.register(require('./api/approvals'), { prefix: '/api/approvals' });

// ── Webhook ingestion — POST /webhooks/:workspaceId ────────────
// For use with n8n, Zapier, Make.com, or any no-code platform.
// No auth — the workspaceId URL segment acts as the identifier.
fastify.post('/webhooks/:workspaceId', async (request, reply) => {
  const { workspaceId } = request.params;
  const { action_type, payload, context = {} } = request.body || {};

  if (!action_type) {
    return reply.code(400).send({ error: 'action_type is required' });
  }

  const ctx = {
    workspaceId,
    projectId:  context.project_id || context.projectId || 'default',
    agent:      context.agent       || 'webhook-agent',
    actionType: action_type,
    source:     context.source      || 'webhook',
    payload:    payload             || {},
  };

  const result = await shieldKernel.before(ctx);

  return reply.send({
    verdict:     result.verdict,
    risk_score:  result.risk_score ?? 0,
    action_id:   result.action_id,
    reason:      result.reason,
    proceed:     result.proceed,
    approval_id: result.approval_id || null,
  });
});

// ── Global error handler ───────────────────────────────────────
fastify.setErrorHandler((err, request, reply) => {
  const statusCode = err.statusCode || err.status || 500;
  fastify.log.error({ err, url: request.url, method: request.method }, 'Unhandled error');
  reply.code(statusCode).send({
    error:   statusCode >= 500 ? 'Internal server error' : (err.message || 'Bad request'),
    code:    statusCode,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// ── Start ──────────────────────────────────────────────────────
async function start() {
  try {
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`AgentShield Core running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();

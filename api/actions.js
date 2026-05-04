'use strict';
/**
 * api/actions.js
 *   POST /api/actions — submit an agent action through the Shield kernel
 *   GET  /api/actions — paginated action history
 *
 * POST body:
 *   { action_type, payload?, context?: { agent?, source?, project_id? } }
 *
 * Response:
 *   { verdict, risk_score, action_id, reason, proceed, approval_id }
 */

const { getDb }  = require('../db');
const shield     = require('../core/shield_kernel');

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'default';

module.exports = async function (fastify, opts) {

  // ── GET /api/actions ─────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const db = getDb();
    try {
      const page   = Math.max(1, parseInt(request.query.page  ?? 1));
      const limit  = Math.min(100, Math.max(1, parseInt(request.query.limit ?? 10)));
      const offset = (page - 1) * limit;

      const conditions = ['workspace_id = ?'];
      const params     = [WORKSPACE_ID];

      const action_type = request.query.action_type || null;
      const status      = request.query.status      || null;
      const date_from   = request.query.date_from   || null;
      const date_to     = request.query.date_to     || null;

      if (action_type) { conditions.push('action_type = ?');       params.push(action_type); }
      if (status)      { conditions.push('status = ?');             params.push(status);      }
      if (date_from)   { conditions.push('date(created_at) >= ?'); params.push(date_from);   }
      if (date_to)     { conditions.push('date(created_at) <= ?'); params.push(date_to);     }

      const where = conditions.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM agent_actions WHERE ${where}`)
        .get(...params)?.n ?? 0;

      const rows = db.prepare(
        `SELECT id, agent, action_type, source, status, risk_score, hook_verdict,
                cost_tokens, cost_usd, authorized, note, created_at, resolved_at
           FROM agent_actions WHERE ${where}
          ORDER BY created_at DESC LIMIT ? OFFSET ?`
      ).all(...params, limit, offset);

      return { rows, total, page, limit };
    } finally { db.close(); }
  });

  // ── POST /api/actions ─────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const { action_type, payload, context = {} } = request.body || {};

    if (!action_type) {
      reply.code(400); return { error: 'action_type is required' };
    }
    if (typeof action_type !== 'string') {
      reply.code(400); return { error: 'action_type must be a string' };
    }
    if (action_type.length > 100) {
      reply.code(400); return { error: 'action_type must be 100 characters or fewer' };
    }
    if (context.agent !== undefined && (typeof context.agent !== 'string' || context.agent.length > 50)) {
      reply.code(400); return { error: 'context.agent must be a string of 50 characters or fewer' };
    }
    if (payload !== undefined && (typeof payload !== 'object' || Array.isArray(payload))) {
      reply.code(400); return { error: 'payload must be an object' };
    }

    const ctx = {
      workspaceId: WORKSPACE_ID,
      projectId:   context.project_id || context.projectId || 'default',
      agent:       context.agent      || 'api-agent',
      actionType:  action_type,
      source:      context.source     || 'api',
      payload:     payload            || {},
    };

    const result = await shield.before(ctx);

    return {
      verdict:     result.verdict,
      risk_score:  result.risk_score ?? 0,
      action_id:   result.action_id,
      reason:      result.reason,
      proceed:     result.proceed,
      approval_id: result.approval_id || null,
    };
  });
};

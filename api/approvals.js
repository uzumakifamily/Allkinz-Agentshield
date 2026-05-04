'use strict';
/**
 * api/approvals.js
 *   GET  /api/approvals         — list pending approvals
 *   POST /api/approvals/:id/resolve — approve or deny a paused action
 */

const { resolveApproval } = require('../core/shield_kernel');
const { getDb }           = require('../db');

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'default';

module.exports = async function (fastify, opts) {
  // GET /api/approvals
  fastify.get('/', async (request, reply) => {
    const db   = getDb();
    const rows = db.prepare(
      `SELECT aq.id, aq.action_id, aq.reason, aq.created_at, aq.decision, aq.decided_at,
              aa.action_type, aa.agent, aa.risk_score
         FROM approval_queue aq
         JOIN agent_actions aa ON aq.action_id = aa.id
        WHERE aq.workspace_id = ?
          AND aq.decision IS NULL
        ORDER BY aq.created_at DESC`
    ).all(WORKSPACE_ID);
    db.close();
    return { rows, total: rows.length };
  });

  // POST /api/approvals/:id/resolve
  fastify.post('/:id/resolve', async (request, reply) => {
    const { decision } = request.body || {};
    if (!['approved', 'denied'].includes(decision)) {
      reply.code(400);
      return { error: 'decision must be "approved" or "denied"' };
    }

    const outcome = resolveApproval(request.params.id, decision, request.body?.decided_by || 'api');

    if (outcome.ok && decision === 'approved' && outcome.action_id) {
      const db = getDb();
      db.prepare('UPDATE agent_actions SET authorized=1 WHERE id=?').run(outcome.action_id);
      db.close();
    }

    return outcome;
  });
};

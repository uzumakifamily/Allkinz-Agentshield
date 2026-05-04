'use strict';
/**
 * api/rules.js — Shield rules CRUD
 *   GET    /api/rules        — list all rules
 *   POST   /api/rules        — create a rule
 *   PATCH  /api/rules/:id    — update rule (enabled state, verdict, note)
 *   DELETE /api/rules/:id    — remove a rule
 *   PATCH  /api/rules/:id/toggle — flip active state
 */

const { getDb } = require('../db');
const crypto    = require('crypto');

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'default';

const DECISION_TO_VERDICT = {
  block:            'deny',
  BLOCK:            'deny',
  deny:             'deny',
  require_approval: 'require_approval',
  PAUSE:            'require_approval',
  allow:            'allow',
  ALLOW:            'allow',
};

const VERDICT_TO_DECISION = {
  deny:             'block',
  require_approval: 'require_approval',
  allow:            'allow',
};

function normaliseRow(r) {
  return {
    id:           r.id,
    workspace_id: r.workspace_id,
    action_type:  r.action_type,
    verdict:      r.verdict,
    decision:     VERDICT_TO_DECISION[r.verdict] ?? r.verdict,
    note:         r.reason || '',
    reason:       r.reason || '',
    active:       r.active === 1 || r.active === true,
    enabled:      r.active === 1 || r.active === true,
    condition:    r.condition || null,
    created_at:   r.created_at,
  };
}

module.exports = async function (fastify, opts) {
  // ── GET /api/rules ─────────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const db   = getDb();
    try {
      const rows = db.prepare(
        `SELECT id, workspace_id, action_type, verdict, reason, active, condition, created_at
           FROM shield_rules
          WHERE workspace_id = ?
          ORDER BY created_at DESC`
      ).all(WORKSPACE_ID);
      const normalised = rows.map(normaliseRow);
      return { rows: normalised, rules: normalised, total: normalised.length };
    } finally { db.close(); }
  });

  // ── POST /api/rules ────────────────────────────────────────────
  fastify.post('/', async (request, reply) => {
    const {
      action_type,
      decision,
      verdict: rawVerdict,
      note,
      reason: rawReason,
      rule_id: bodyId,
      condition_json,
    } = request.body || {};

    if (!action_type) {
      reply.code(400);
      return { error: 'action_type is required' };
    }

    const decisionVal = decision || rawVerdict || 'block';
    const dbVerdict   = DECISION_TO_VERDICT[decisionVal];
    if (!dbVerdict) {
      reply.code(400);
      return { error: `Invalid decision "${decisionVal}" — use block, require_approval, or allow` };
    }

    const ruleId = bodyId || `rule_${action_type}_${crypto.randomBytes(4).toString('hex')}`;
    if (!/^[a-z0-9_]+$/i.test(ruleId)) {
      reply.code(400);
      return { error: 'rule_id must be alphanumeric with underscores only' };
    }

    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO shield_rules (id, workspace_id, action_type, verdict, reason, condition, active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).run(ruleId, WORKSPACE_ID, action_type, dbVerdict, note || rawReason || null, condition_json || null);

      const row = db.prepare('SELECT * FROM shield_rules WHERE id = ?').get(ruleId);
      reply.code(201);
      return { ok: true, rule: normaliseRow(row) };
    } catch (e) {
      if (e.message.includes('UNIQUE')) {
        reply.code(409);
        return { error: `A rule with ID "${ruleId}" already exists` };
      }
      throw e;
    } finally { db.close(); }
  });

  // ── PATCH /api/rules/:id ───────────────────────────────────────
  fastify.patch('/:id', async (request, reply) => {
    const ruleId = request.params.id;
    const { enabled, active, verdict, decision, note } = request.body || {};

    const db = getDb();
    try {
      const existing = db.prepare(
        'SELECT * FROM shield_rules WHERE id = ? AND workspace_id = ?'
      ).get(ruleId, WORKSPACE_ID);

      if (!existing) {
        reply.code(404);
        return { error: 'Rule not found' };
      }

      let newActive = existing.active;
      if (enabled !== undefined) newActive = enabled ? 1 : 0;
      if (active  !== undefined) newActive = active  ? 1 : 0;

      let newVerdict = existing.verdict;
      const decisionVal = decision || verdict;
      if (decisionVal) {
        const mapped = DECISION_TO_VERDICT[decisionVal];
        if (mapped) newVerdict = mapped;
      }

      const newReason = (note !== undefined) ? note : existing.reason;

      db.prepare(
        'UPDATE shield_rules SET active=?, verdict=?, reason=? WHERE id=? AND workspace_id=?'
      ).run(newActive, newVerdict, newReason, ruleId, WORKSPACE_ID);

      const updated = db.prepare('SELECT * FROM shield_rules WHERE id=?').get(ruleId);
      return { ok: true, rule: normaliseRow(updated) };
    } finally { db.close(); }
  });

  // ── PATCH /api/rules/:id/toggle ────────────────────────────────
  fastify.patch('/:id/toggle', async (request, reply) => {
    const ruleId = request.params.id;

    const db = getDb();
    try {
      const existing = db.prepare(
        'SELECT * FROM shield_rules WHERE id = ? AND workspace_id = ?'
      ).get(ruleId, WORKSPACE_ID);

      if (!existing) {
        reply.code(404);
        return { error: 'Rule not found' };
      }

      const newActive = existing.active === 1 ? 0 : 1;
      db.prepare('UPDATE shield_rules SET active = ? WHERE id = ?').run(newActive, ruleId);
      return { ok: true, id: ruleId, active: newActive === 1, enabled: newActive === 1 };
    } finally { db.close(); }
  });

  // ── DELETE /api/rules/:id ──────────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const ruleId = request.params.id;

    const db = getDb();
    try {
      const result = db.prepare(
        'DELETE FROM shield_rules WHERE id = ? AND workspace_id = ?'
      ).run(ruleId, WORKSPACE_ID);

      if (result.changes === 0) {
        reply.code(404);
        return { error: 'Rule not found' };
      }
      return { ok: true, id: ruleId };
    } finally { db.close(); }
  });
};

'use strict';
/**
 * api/audit.js
 *   GET /api/audit        — full action history (paginated)
 *   GET /api/audit/export — download as CSV
 */

const { getDb } = require('../db');

const WORKSPACE_ID = process.env.WORKSPACE_ID || 'default';

const CSV_COLS = [
  'id','action_type','status','hook_verdict',
  'risk_score','authorized','cost_usd','cost_tokens','note','created_at',
];

module.exports = async function (fastify, opts) {
  // ── GET /api/audit ──────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const db = getDb();

    const page   = Math.max(1, parseInt(request.query.page  ?? 1));
    const limit  = Math.min(100, parseInt(request.query.limit ?? 50));
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
      `SELECT id, agent, action_type, status, hook_verdict, risk_score,
              authorized, cost_usd, cost_tokens, note, created_at
         FROM agent_actions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    db.close();
    return { rows, total, page, limit };
  });

  // ── GET /api/audit/export ────────────────────────────────────
  fastify.get('/export', async (request, reply) => {
    const db    = getDb();
    const today = new Date().toISOString().slice(0, 10);

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

    const rows = db.prepare(
      `SELECT id, action_type, status, hook_verdict, risk_score,
              authorized, cost_usd, cost_tokens, note, created_at
         FROM agent_actions
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC`
    ).all(...params);
    db.close();

    const escapeCSV = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [
      CSV_COLS.join(','),
      ...rows.map(r => CSV_COLS.map(c => escapeCSV(r[c])).join(',')),
    ];

    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="agentshield-audit-${today}.csv"`)
      .send(lines.join('\n'));
  });
};

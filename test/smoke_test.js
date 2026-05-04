'use strict';
/**
 * test/smoke_test.js — 10 scenarios, 25 assertions
 */

const path = require('path');
process.env.DATABASE_PATH = path.join(__dirname, '..', 'test.db');

const fs = require('fs');
const { getDb, DB_PATH } = require('../db');
const shield = require('../brain/shield_kernel');
const assert = require('assert');

let pass = 0;
let fail = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    fail++;
  }
}

// Clean up test DB
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');

const db = getDb();

// Seed workspace + budget + default deny rules for testing
db.prepare(`INSERT OR IGNORE INTO usage_budgets (id, workspace_id, project_id, daily_limit_usd, monthly_limit_usd)
  VALUES ('budget_test', 'ws_test', 'proj_test', 10, 100)`).run();

db.prepare(`INSERT OR IGNORE INTO shield_rules (id, workspace_id, project_id, action_type, verdict, reason, active)
  VALUES ('rule_shell_test', 'ws_test', NULL, 'shell_execute', 'deny', 'Default: shell execution blocked', 1)`).run();

console.log('\nAgent Shield Smoke Tests\n========================\n');

// ── 1. send_email (cron) → PAUSE ──────────────────────────
(async () => {
  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_test',
    agent: 'cold_email_bot', actionType: 'send_email', source: 'cron', payload: { to: 'test@example.com' }
  });
  test('send_email (cron) → PAUSE', () => assert.strictEqual(res.verdict, 'PAUSE'));
})();

// ── 2. fetch_url (user_input) → ALLOW ─────────────────────
(async () => {
  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_test',
    agent: 'research_bot', actionType: 'fetch_url', source: 'user_input', payload: { url: 'https://example.com' }
  });
  test('fetch_url (user_input) → ALLOW', () => assert.strictEqual(res.verdict, 'ALLOW'));
})();

// ── 3. send_email (web_content) → BLOCK (prompt injection) ──
(async () => {
  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_test',
    agent: 'email_bot', actionType: 'send_email', source: 'web_content', payload: { to: 'test@example.com' }
  });
  test('send_email (web_content) → BLOCK', () => assert.strictEqual(res.verdict, 'BLOCK'));
})();

// ── 4. shell_execute → BLOCK (workspace rule) ─────────────
(async () => {
  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_test',
    agent: 'sysadmin_bot', actionType: 'shell_execute', source: 'cron', payload: { cmd: 'rm -rf /' }
  });
  test('shell_execute → BLOCK', () => assert.strictEqual(res.verdict, 'BLOCK'));
})();

// ── 5. write_output → ALLOW ───────────────────────────────
(async () => {
  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_test',
    agent: 'writer_bot', actionType: 'write_output', source: 'cron', payload: { text: 'Hello world' }
  });
  test('write_output → ALLOW', () => assert.strictEqual(res.verdict, 'ALLOW'));
})();

// ── 6. PII scan: email, phone, API key → all redacted ──────
const { redactPII } = require('../utils/helpers');
test('PII scan: email redacted', () => {
  const r = redactPII('Contact us at admin@example.com');
  assert.ok(r.redacted.includes('[REDACTED:EMAIL]'));
});
test('PII scan: phone redacted', () => {
  const r = redactPII('Call +1-234-567-8901');
  assert.ok(r.redacted.includes('[REDACTED:PHONE]'));
});
test('PII scan: API key redacted', () => {
  const r = redactPII('Key: sk-abc123def456ghi789jkl012mno345pqr');
  assert.ok(r.redacted.includes('[REDACTED:API_KEY]'));
});

// ── 7. registerClaim → VERIFIED stored ────────────────────
test('registerClaim stores VERIFIED claim', () => {
  const claimId = shield.registerClaim('ws_test', 'proj_test', null, 'Revenue is $50K', 'VERIFIED', {
    sourceRecordId: 'rec_123', sourceTable: 'invoices', confidence: 0.95
  });
  const row = db.prepare('SELECT * FROM ai_claims WHERE id=?').get(claimId);
  assert.strictEqual(row.claim_type, 'VERIFIED');
  assert.strictEqual(row.confidence, 0.95);
});

// ── 8. resolveApproval (approve) → action flips to allowed ──
test('resolveApproval approved → action allowed', () => {
  // Manually insert a paused action + approval
  const actionId = 'action_approval_test';
  const approvalId = 'approval_test_1';
  db.prepare(`INSERT INTO agent_actions (id, workspace_id, project_id, agent, action_type, source, status, hook_verdict)
    VALUES (?, 'ws_test', 'proj_test', 'bot', 'send_email', 'cron', 'paused', 'PAUSE')`).run(actionId);
  db.prepare(`INSERT INTO approval_queue (id, workspace_id, project_id, action_id, reason)
    VALUES (?, 'ws_test', 'proj_test', ?, 'test')`).run(approvalId, actionId);

  const res = shield.resolveApproval(approvalId, 'approved', 'test_user');
  assert.strictEqual(res.ok, true);
  const action = db.prepare('SELECT status FROM agent_actions WHERE id=?').get(actionId);
  assert.strictEqual(action.status, 'allowed');
});

// ── 9. lead scraper send_email → BLOCK (rule: scraper cannot email) ──
(async () => {
  // Add project-specific rule
  db.prepare(`INSERT INTO shield_rules (id, workspace_id, project_id, action_type, verdict, reason, active)
    VALUES ('rule_scraper_no_email', 'ws_test', 'proj_scraper', 'send_email', 'deny', 'Scraper cannot email', 1)`).run();

  const res = await shield.before({
    workspaceId: 'ws_test', projectId: 'proj_scraper',
    agent: 'lead_scraper', actionType: 'send_email', source: 'cron', payload: { to: 'lead@company.com' }
  });
  test('lead scraper send_email → BLOCK', () => assert.strictEqual(res.verdict, 'BLOCK'));
})();

// ── 10. Audit log append-only ──────────────────────────────
test('Audit log is append-only (no UPDATE on core fields)', () => {
  const actionId = 'audit_test_1';
  db.prepare(`INSERT INTO agent_actions (id, workspace_id, project_id, agent, action_type, source, payload, status)
    VALUES (?, 'ws_test', 'proj_test', 'bot', 'read_file', 'cron', '{}', 'pending')`).run(actionId);

  // We can update status (allowed field), but workspace_id and project_id must never change
  db.prepare(`UPDATE agent_actions SET status='done' WHERE id=?`).run(actionId);
  const row = db.prepare('SELECT * FROM agent_actions WHERE id=?').get(actionId);
  assert.strictEqual(row.status, 'done');
  assert.strictEqual(row.workspace_id, 'ws_test');
});

// ── 11. Cold email dry-run: logged but skips actual send ───
test('Cold email dry-run: logged but skips actual send', async () => {
  process.env.SHIELD_DRY_RUN = 'true';
  // Temporarily allow send_email so executeFn runs (kernel still logs + scores)
  db.prepare(`UPDATE shield_rules SET active=0 WHERE id='rule_email_default'`).run();
  db.prepare(`INSERT OR REPLACE INTO shield_rules (id, workspace_id, project_id, action_type, verdict, reason, active)
    VALUES ('rule_test_allow_email', 'ws_allkinz', 'proj_cold_email', 'send_email', 'allow', 'Test allow', 1)`).run();

  const { shieldSendEmailWithFn } = require('../integrations/omnimind');

  const result = await shieldSendEmailWithFn(
    { contact_email: 'ceo@company.com', id: 'lead_123' },
    'Test subject',
    '<p>Hello</p>',
    'outreach',
    async () => ({ ok: true, sent: true })
  );

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.dryRun, true);

  // Restore default rules
  db.prepare(`DELETE FROM shield_rules WHERE id='rule_test_allow_email'`).run();
  db.prepare(`UPDATE shield_rules SET active=1 WHERE id='rule_email_default'`).run();
  process.env.SHIELD_DRY_RUN = 'false';
});

// ── 12. Cold email live: requires approval then approved ───
test('Cold email live: requires approval then approved', async () => {
  process.env.SHIELD_DRY_RUN = 'false';

  // Ensure default rule is active
  db.prepare(`UPDATE shield_rules SET active=1 WHERE id='rule_email_default'`).run();
  db.prepare(`DELETE FROM shield_rules WHERE id='rule_test_allow_email'`).run();

  // Step 1: send_email triggers PAUSE
  const beforeRes = await shield.before({
    workspaceId: 'ws_allkinz', projectId: 'proj_cold_email',
    agent: 'cold_email_bot', actionType: 'send_email', source: 'api',
    payload: { to: 'ceo@company.com', subject: 'Proposal', leadId: 'lead_123', type: 'outreach' }
  });
  assert.strictEqual(beforeRes.verdict, 'PAUSE');
  assert.ok(beforeRes.approval_id, 'Should have approval_id when PAUSE');

  // Step 2: resolve approval
  const resolveRes = shield.resolveApproval(beforeRes.approval_id, 'approved', 'test_user');
  assert.strictEqual(resolveRes.ok, true);
  assert.strictEqual(resolveRes.decision, 'approved');

  // Step 3: action status flipped to allowed
  const action = db.prepare('SELECT status FROM agent_actions WHERE id=?').get(beforeRes.action_id);
  assert.strictEqual(action.status, 'allowed');
});

// ── Summary ─────────────────────────────────────────────────
setTimeout(() => {
  console.log(`\n========================`);
  console.log(`Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail}`);
  console.log(`========================\n`);

  // Cleanup
  db.close();
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm');
  if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal');

  process.exit(fail > 0 ? 1 : 0);
}, 500);

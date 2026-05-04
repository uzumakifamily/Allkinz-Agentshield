-- AgentShield Core — database schema
-- 3 tables, append-only design

-- 1. Every action any agent takes, logged before execution
CREATE TABLE IF NOT EXISTS agent_actions (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  agent         TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  source        TEXT NOT NULL,  -- 'user_input' | 'web_content' | 'email' | 'cron' | 'api' | 'webhook'
  payload       TEXT,           -- JSON
  result        TEXT,           -- JSON (PII-redacted)
  status        TEXT DEFAULT 'pending',  -- pending | allowed | paused | denied | done | failed
  risk_score    REAL DEFAULT 0,
  hook_verdict  TEXT,           -- ALLOW | PAUSE | BLOCK
  cost_tokens   INTEGER DEFAULT 0,
  cost_usd      REAL DEFAULT 0,
  authorized    INTEGER DEFAULT 0,
  note          TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  resolved_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_workspace ON agent_actions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_actions_project   ON agent_actions(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_actions_status    ON agent_actions(status);

-- 2. Allow/deny rulebook per project
CREATE TABLE IF NOT EXISTS shield_rules (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT,              -- NULL = workspace-wide
  action_type   TEXT NOT NULL,
  verdict       TEXT NOT NULL,     -- allow | deny | require_approval
  source_trust  TEXT,              -- JSON array of trusted sources
  condition     TEXT,              -- JSON (reserved for future use)
  reason        TEXT,
  active        INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_workspace ON shield_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_rules_project   ON shield_rules(workspace_id, project_id);

-- 3. Actions paused waiting for human approval
CREATE TABLE IF NOT EXISTS approval_queue (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  project_id    TEXT NOT NULL,
  action_id     TEXT NOT NULL REFERENCES agent_actions(id),
  reason        TEXT,
  tg_msg_id     TEXT,
  notified_at   TEXT,
  decided_at    TEXT,
  decision      TEXT,             -- approved | denied
  decided_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_approvals_action ON approval_queue(action_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_queue(decision);

-- Default safe rules for the 'default' workspace
INSERT OR IGNORE INTO shield_rules (id, workspace_id, project_id, action_type, verdict, reason)
VALUES
  ('rule_email_default',   'default', NULL, 'send_email',    'require_approval', 'Default: emails require approval'),
  ('rule_delete_default',  'default', NULL, 'delete_file',   'deny',             'Default: file deletion blocked'),
  ('rule_shell_default',   'default', NULL, 'shell_execute', 'deny',             'Default: shell execution blocked'),
  ('rule_code_default',    'default', NULL, 'run_code',      'deny',             'Default: code execution blocked'),
  ('rule_deploy_default',  'default', NULL, 'deploy',        'deny',             'Default: deploy blocked'),
  ('rule_read_default',    'default', NULL, 'read_file',     'allow',            'Default: read allowed'),
  ('rule_fetch_default',   'default', NULL, 'fetch_url',     'allow',            'Default: fetch allowed'),
  ('rule_write_default',   'default', NULL, 'write_output',  'allow',            'Default: write output allowed'),
  ('rule_search_default',  'default', NULL, 'search',        'allow',            'Default: search allowed');

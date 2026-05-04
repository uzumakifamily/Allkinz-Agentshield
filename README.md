# AgentShield Core

**Self-hostable trust layer for AI agents.** Every action your agent wants to take passes through a 3-hook kernel — risk-scored, policy-checked, PII-redacted, and logged — before it runs.

🌐 **Cloud (managed):** [agentshield.allkinz.com](https://agentshield.allkinz.com)  
📦 **License:** MIT  
🔧 **Stack:** Node.js 18+ · Fastify 4 · better-sqlite3

---

## What It Does

AgentShield sits between your AI agent and the outside world:

| Step | What happens |
|---|---|
| **1. Risk score** | Every action gets a 0–1 score based on action type, source, payload size, and PII presence |
| **2. Policy check** | Your rules decide: `ALLOW`, `PAUSE` (human approval required), or `BLOCK` |
| **3. PII redaction** | Results are scanned before logging — emails, API keys, phone numbers are auto-redacted |
| **4. Audit log** | Every verdict is written to SQLite with timestamp, agent, score, and reason |

Default safe rules (seeded at startup): emails require approval, file deletion/shell/deploy/run_code are blocked.

---

## Quick Start

```bash
git clone https://github.com/uzumakifamily/Allkinz-Agentshield
cd Allkinz-Agentshield
npm install
cp .env.example .env      # edit DATABASE_PATH if needed
npm start                 # → http://localhost:3000
```

Test it:
```bash
curl -s -X POST http://localhost:3000/api/actions \
  -H "Content-Type: application/json" \
  -d '{ "action_type": "send_email", "payload": { "to": "user@example.com" } }' | jq
# → { "verdict": "PAUSE", "risk_score": 0.85, "approval_id": "..." }

curl -s http://localhost:3000/health
# → { "status": "ok", "version": "1.0.0", ... }
```

---

## Integrate in 3 Lines

```js
const shield = require('./integrations/sdk');

await shield.run({
  workspaceId: 'default',
  actionType:  'send_email',
  source:      'api',
  payload:     { to: 'customer@example.com', subject: 'Follow-up' },
}, async () => {
  // only runs if Shield says ALLOW
  await sendEmail(...);
});
```

**REST API:**
```bash
curl -X POST http://localhost:3000/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "send_email",
    "payload":     { "to": "user@example.com" },
    "context":     { "agent": "my-bot", "source": "api" }
  }'
```

---

## API Reference

### `POST /api/actions`
Evaluate an agent action.

**Body:**
```json
{
  "action_type": "send_email",
  "payload":     { "to": "user@example.com" },
  "context":     { "agent": "my-bot", "source": "api", "project_id": "proj_1" }
}
```

**Response:**
```json
{
  "verdict":     "PAUSE",
  "risk_score":  0.85,
  "action_id":   "act_abc123",
  "reason":      "Default: emails require approval",
  "proceed":     false,
  "approval_id": "apv_xyz789"
}
```

Verdicts: `ALLOW` | `PAUSE` | `BLOCK`

---

### `GET /api/actions`
Paginated action history.  
Query params: `page`, `limit`, `action_type`, `status`, `date_from`, `date_to`

### `GET /api/audit`
Full audit log with all fields.  
`GET /api/audit/export` — CSV download.

### `GET /api/rules`
List all policy rules.

### `POST /api/rules`
Create a rule.
```json
{ "action_type": "deploy", "decision": "block", "note": "No deploys from agents" }
```
`decision`: `allow` | `block` | `require_approval`

### `PATCH /api/rules/:id`
Update a rule's `enabled`, `verdict`, or `note`.

### `GET /api/approvals`
List pending (undecided) approvals.

### `POST /api/approvals/:id/resolve`
Approve or deny a paused action.
```json
{ "decision": "approved" }
```

### `POST /webhooks/:workspaceId`
No-code platform ingestion (n8n, Zapier, Make.com). Same as `/api/actions` but authenticated by the workspaceId URL segment.

### `GET /health`
```json
{ "status": "ok", "version": "1.0.0", "timestamp": "2026-05-04T10:00:00.000Z" }
```

---

## Approval Flow

When an action gets `PAUSE`:
1. AgentShield creates an entry in `approval_queue`
2. (Optional) Sends a Telegram notification with `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
3. You `POST /api/approvals/:id/resolve` with `{ "decision": "approved" }` or `"denied"`
4. The `agent_actions` record is updated and the calling agent can proceed

---

## Architecture

```
core/shield_kernel.js   — 3-hook kernel (before / after / run / resolveApproval)
utils/helpers.js        — risk scoring, PII redaction, cost estimation
utils/notify.js         — optional Telegram alerts
api/actions.js          — POST /api/actions + GET /api/actions
api/audit.js            — GET /api/audit + /export
api/rules.js            — CRUD for policy rules
api/approvals.js        — GET /api/approvals + POST resolve
api/health.js           — GET /health
db/index.js             — better-sqlite3 connection factory
db/schema.sql           — 3-table schema (auto-applied on startup)
integrations/sdk.js     — Node.js SDK wrapper
integrations/webhook.js — Webhook pattern (scaffold)
integrations/proxy.js   — HTTPS proxy pattern (scaffold)
server.js               — Fastify entry point
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_PATH` | No | `./shield.db` | SQLite file path |
| `WORKSPACE_ID` | No | `default` | All actions log under this ID |
| `PORT` | No | `3000` | HTTP port |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `TELEGRAM_BOT_TOKEN` | No | — | Enable Telegram approval alerts |
| `TELEGRAM_CHAT_ID` | No | — | Chat to send Telegram alerts to |

---

## Deployment (Railway)

See [DEPLOY.md](./DEPLOY.md) for the full step-by-step guide.

```bash
npm install -g @railway/cli
railway login
railway init
railway variables set NODE_ENV=production
railway variables set DATABASE_PATH=/data/shield.db
railway up
```

Add a volume at `/data` in Railway Settings → Volumes to persist the SQLite database across deployments.

---

## AgentShield Cloud

The self-hosted core gives you the full engine. [AgentShield Cloud](https://agentshield.allkinz.com) adds:

- **Web dashboard** — visualise all actions, rules, and approvals in a browser
- **Team auth** — email OTP + Google OAuth, multi-user workspaces
- **Multi-workspace** — separate rule sets per project or team
- **Managed hosting** — zero ops, automatic backups, Railway-based HA

[→ Get started free](https://agentshield.allkinz.com)

---

## Self-Host Limits

| Feature | Core (this repo) | Cloud |
|---|---|---|
| Risk scoring | ✅ | ✅ |
| Policy engine (rules) | ✅ | ✅ |
| PII redaction | ✅ | ✅ |
| Audit log | ✅ | ✅ |
| Approval flow | ✅ (API) | ✅ (UI + API) |
| Telegram alerts | ✅ (env vars) | ✅ (per workspace) |
| Web dashboard | ❌ | ✅ |
| Auth (login/OTP/Google) | ❌ | ✅ |
| Multi-workspace | ❌ | ✅ |
| Managed hosting | ❌ | ✅ |

---

## Security

- Prompt injection defense: `web_content` + `email` sources are blocked from high-risk actions by default
- PII auto-redaction: emails, phone numbers, Aadhaar, API keys, passwords stripped before logging
- Rate limiting: 100 action evaluations per hour per IP
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS (on HTTPS)
- Self-hosted — no data leaves your server

---

## License

MIT © 2026 Allkinz

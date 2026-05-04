'use strict';
/**
 * utils/helpers.js — risk scoring, PII scanning, cost estimation
 */

// ── Risk scoring ───────────────────────────────────────────
const ACTION_RISK = {
  'send_email':    0.55, 'send_sms':      0.60, 'send_whatsapp': 0.60,
  'delete_file':   0.85, 'shell_execute': 0.90, 'run_code':      0.75,
  'deploy':        0.80, 'payment':       0.95, 'transfer_funds':1.00,
  'write_file':    0.35, 'write_output':  0.10, 'read_file':     0.05,
  'fetch_url':     0.15, 'search':        0.08, 'get_leads':     0.10,
};

const SOURCE_RISK = {
  'user_input':   0.10, 'cron':        0.05, 'api':         0.20,
  'web_content':  0.45, 'email':       0.50,
};

function riskScore({ actionType, source, payload }) {
  let score = ACTION_RISK[actionType] || 0.30;
  score += SOURCE_RISK[source] || 0.20;

  // Blast radius
  const count = payload?.count || payload?.recipients?.length || 1;
  if (count > 100) score += 0.25;
  else if (count > 20) score += 0.12;
  else if (count > 5) score += 0.05;

  // PII in payload bumps risk
  const payloadStr = JSON.stringify(payload || {});
  if (PII_PATTERNS.some(p => p.rx.test(payloadStr))) score += 0.15;

  // Irreversibility
  const irreversible = ['delete','send','post','publish','payment','transfer','shell','deploy'];
  if (irreversible.some(k => actionType.includes(k))) score += 0.10;

  return Math.min(1.0, score);
}

// ── PII scanning ───────────────────────────────────────────
const PII_PATTERNS = [
  { name: 'email',   rx: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,     label: 'EMAIL' },
  { name: 'phone',   rx: /(\+?[\d\s\-().]{10,16})/g,                               label: 'PHONE' },
  { name: 'aadhaar', rx: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,                       label: 'AADHAAR' },
  { name: 'apikey',  rx: /\bsk-[a-zA-Z0-9]{20,60}\b/g,                             label: 'API_KEY' },
  { name: 'password',rx: /password\s*[:=]\s*\S+/gi,                                 label: 'PASSWORD' },
];

function redactPII(text) {
  if (typeof text !== 'string') text = String(text || '');
  const matches = [];
  let redacted = text;

  for (const p of PII_PATTERNS) {
    const found = redacted.match(p.rx);
    if (found) {
      matches.push(`${p.label}:${found.length}`);
      redacted = redacted.replace(p.rx, `[REDACTED:${p.label}]`);
    }
  }

  return { redacted, matches };
}

// ── Cost estimation ────────────────────────────────────────
function estimateCost(result) {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  // Very naive: ~4 chars per token
  return Math.ceil(str.length / 4);
}

module.exports = {
  riskScore,
  redactPII,
  estimateCost,
  PII_PATTERNS,
};

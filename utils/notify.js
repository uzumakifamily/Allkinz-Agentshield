'use strict';
/**
 * utils/notify.js — Optional Telegram approval notifications
 *
 * Configure with env vars:
 *   TELEGRAM_BOT_TOKEN  — your bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — your chat or group ID
 *
 * If either variable is missing, notifications are silently skipped.
 */

const https = require('https');

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req  = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => { try { resolve(JSON.parse(chunks)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a Telegram notification for a pending approval.
 * Returns the Telegram message_id on success, or null if not configured / on error.
 */
async function notifyApproval({ approvalId, actionId, agent, actionType, reason }) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;

  try {
    const res = await postJSON(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        chat_id:    chatId,
        parse_mode: 'HTML',
        text: [
          '<b>⚠️ AgentShield — Approval Required</b>',
          '',
          `<b>Agent:</b>  ${agent || 'unknown'}`,
          `<b>Action:</b> ${actionType}`,
          `<b>Reason:</b> ${reason || 'Risk threshold exceeded'}`,
          '',
          `Approval ID: <code>${approvalId}</code>`,
          '',
          'To approve:',
          `<code>POST /api/approvals/${approvalId}/resolve</code>`,
          '<code>{ "decision": "approved" }</code>',
        ].join('\n'),
      }
    );
    return res.result?.message_id || null;
  } catch (err) {
    console.warn('[notify] Telegram send failed:', err.message);
    return null;
  }
}

module.exports = { notifyApproval };

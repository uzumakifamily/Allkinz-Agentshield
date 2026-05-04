'use strict';
/**
 * integrations/sdk.js — Node.js SDK wrapper
 *
 * Usage:
 *   const shield = require('./integrations/sdk');
 *   const result = await shield.run(ctx, () => myAgentFn());
 */

const { run, before, after, getPermittedTools } = require('../core/shield_kernel');

module.exports = { run, before, after, getPermittedTools };

'use strict';
/**
 * api/health.js — Health check route
 */

module.exports = async function (fastify, opts) {
  fastify.get('/', async (request, reply) => {
    return { status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() };
  });
};

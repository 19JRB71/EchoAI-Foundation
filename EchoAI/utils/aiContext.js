const { AsyncLocalStorage } = require("async_hooks");

/**
 * Ambient request context for AI calls.
 *
 * The provider wrappers (config/anthropic.js, config/hermes.js) are the paid
 * chokepoints, but their ~50 call sites don't all know whether they're running
 * inside a background job or a user request. Instead of threading metadata
 * through every caller, the scheduler (and any other background entry point)
 * wraps its work in `runWithAiContext({ triggeredBy: "background", jobName })`
 * and the wrappers read it here. HTTP requests default to "user".
 */
const storage = new AsyncLocalStorage();

function runWithAiContext(ctx, fn) {
  return storage.run({ ...(storage.getStore() || {}), ...ctx }, fn);
}

function getAiContext() {
  return storage.getStore() || {};
}

module.exports = { runWithAiContext, getAiContext };

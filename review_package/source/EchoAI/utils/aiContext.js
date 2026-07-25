const { AsyncLocalStorage } = require("async_hooks");
const crypto = require("crypto");

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

/**
 * Runs `fn` with a workflow id in scope, minting one when the current context
 * doesn't already carry one. A workflow groups EVERY paid call made while
 * serving one logical request — an HTTP request, a voice utterance, a
 * background job tick, an autonomous-conversation reply — so the ledger can
 * show the true total cost of the chain, including agent fan-out.
 */
function runWithWorkflow(extra, fn) {
  const current = storage.getStore() || {};
  const workflowId = current.workflowId || crypto.randomUUID();
  return storage.run({ ...current, ...extra, workflowId }, fn);
}

module.exports = { runWithAiContext, getAiContext, runWithWorkflow };

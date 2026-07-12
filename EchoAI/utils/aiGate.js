const { getSwitch } = require("../config/aiControls");
const { ENVIRONMENT, isProduction } = require("../config/environment");
const { checkBudget, checkRateLimit } = require("./aiBudget");
const { getAiContext } = require("./aiContext");

/**
 * The single admission gate every paid AI call passes through, called by the
 * provider wrappers (config/anthropic.js, config/hermes.js) BEFORE any money is
 * spent. Order: emergency switches → environment policy → rate limit → budgets.
 *
 * Blocked calls throw an honest, user-presentable error (status 503,
 * err.aiBlocked = true) — never a silent failure and never mocked output.
 */

function blockedError(reason) {
  const err = new Error(`AI is currently unavailable: ${reason}`);
  err.status = 503;
  err.aiBlocked = true;
  err.expose = true;
  return err;
}

/**
 * Resolve call metadata: explicit opts win, then ambient context (set by the
 * scheduler for background jobs), then defaults ("user" trigger).
 */
function resolveMeta(opts = {}) {
  const ctx = getAiContext();
  return {
    triggeredBy: opts.triggeredBy || ctx.triggeredBy || "user",
    jobName: opts.jobName || ctx.jobName || null,
    brandId: opts.brandId ?? ctx.brandId ?? null,
    userId: opts.userId ?? ctx.userId ?? null,
    conversationId: opts.conversationId || ctx.conversationId || null,
    taskType: opts.taskType || ctx.taskType || null,
    agent: opts.agent || ctx.agent || null,
  };
}

/**
 * Throws when the call must not proceed. Returns the resolved meta (with
 * triggeredBy etc.) when it may.
 * @param {string} provider - "anthropic" | "hermes" | "openai" | "elevenlabs"
 * @param {object} [opts] - per-call metadata overrides (see resolveMeta).
 */
async function assertAiAllowed(provider, opts = {}) {
  const meta = resolveMeta(opts);

  if (!(await getSwitch("AI_ENABLED"))) {
    throw blockedError("the administrator has switched AI off (emergency shutoff).");
  }

  if (provider === "anthropic" && !(await getSwitch("ANTHROPIC_CONTENT_ENABLED"))) {
    throw blockedError("Anthropic (Claude) is currently switched off by the administrator.");
  }
  if (provider === "openai" && opts.contentGeneration && !(await getSwitch("OPENAI_CONTENT_ENABLED"))) {
    throw blockedError("OpenAI content generation is not enabled.");
  }

  if (meta.triggeredBy === "background") {
    if (!(await getSwitch("BACKGROUND_AI_ENABLED"))) {
      throw blockedError("background AI is switched off by the administrator.");
    }
  } else if (!(await getSwitch("USER_AI_ENABLED"))) {
    throw blockedError("user-requested AI is switched off by the administrator.");
  }

  // Development safety: no paid calls outside production unless explicitly
  // enabled for a controlled test. This is what stops a rebuild/preview from
  // spending real credits.
  if (!isProduction() && !(await getSwitch("DEVELOPMENT_AI_ENABLED"))) {
    throw blockedError(
      `paid AI calls are disabled in the ${ENVIRONMENT} environment. Set DEVELOPMENT_AI_ENABLED=true (admin setting or env var) for a controlled test.`,
    );
  }

  const rate = await checkRateLimit();
  if (!rate.allowed) throw blockedError(rate.reason);

  const budget = await checkBudget({ triggeredBy: meta.triggeredBy, brandId: meta.brandId });
  if (!budget.allowed) throw blockedError(budget.reason);

  return meta;
}

module.exports = { assertAiAllowed, resolveMeta, blockedError };

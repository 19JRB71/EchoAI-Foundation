const { computeEconomics, getWorkflowDetail } = require("../utils/economics");

// ---------------------------------------------------------------------------
// Private owner AI Economics endpoints (mounted under /api/admin — the router
// already enforces auth + admin, so customers can never reach these).
// ---------------------------------------------------------------------------

/** GET /api/admin/economics — the whole revenue/cost/margin picture. */
async function getEconomics(req, res) {
  try {
    const economics = await computeEconomics();
    res.json(economics);
  } catch (err) {
    console.error("Economics dashboard failed:", err.message);
    res.status(500).json({ error: "Failed to compute economics." });
  }
}

/** GET /api/admin/economics/workflow/:workflowId — one chain's full cost. */
async function getWorkflow(req, res) {
  try {
    const detail = await getWorkflowDetail(String(req.params.workflowId));
    if (detail.calls === 0) {
      return res.status(404).json({ error: "No ledger rows for that workflow id." });
    }
    res.json(detail);
  } catch (err) {
    console.error("Workflow drill-down failed:", err.message);
    res.status(500).json({ error: "Failed to load the workflow detail." });
  }
}

module.exports = { getEconomics, getWorkflow };

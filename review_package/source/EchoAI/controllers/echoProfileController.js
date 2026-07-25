// Echo's relationship profiles + owner profile — the CRUD surface behind the
// Memory tab's "People" and "About You" views. Owner-only (mounted with
// requireOwner in echoRoutes). Relationship profiles are one living record per
// important person; the owner profile is a single row Echo learns over time and
// the owner can correct here.

const db = require("../config/db");
const echoContext = require("../utils/echoContext");

async function getBrand(userId) {
  const { rows } = await db.query(
    "SELECT brand_id FROM brands WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1",
    [userId],
  );
  return rows[0] || null;
}

function mapProfile(r) {
  return {
    id: r.profile_id,
    personName: r.person_name,
    personType: r.person_type,
    entityRef: r.entity_ref,
    caresAbout: r.cares_about,
    history: r.history,
    nextStep: r.next_step,
    sentiment: r.sentiment,
    importance: r.importance,
    updatedAt: r.updated_at,
  };
}

// GET /api/echo/profiles — every relationship profile for the owner.
async function listProfiles(req, res) {
  try {
    const userId = req.user.userId;
    const { rows } = await db.query(
      `SELECT profile_id, person_name, person_type, entity_ref, cares_about, history, next_step, sentiment, importance, updated_at
       FROM echo_relationship_profiles WHERE user_id = $1
       ORDER BY importance DESC, updated_at DESC`,
      [userId],
    );
    return res.json({ profiles: rows.map(mapProfile) });
  } catch (err) {
    console.error("echo listProfiles error:", err.message);
    return res.status(500).json({ error: "Failed to load relationship profiles." });
  }
}

// PUT /api/echo/profiles — create or update a relationship profile (upsert by
// owner + type + name). The owner can edit the next step / notes Echo keeps.
async function saveProfile(req, res) {
  try {
    const userId = req.user.userId;
    const b = req.body || {};
    const name = typeof b.personName === "string" ? b.personName.trim() : "";
    if (!name) return res.status(400).json({ error: "A person needs a name." });
    const brand = await getBrand(userId);
    await echoContext.upsertRelationship(userId, brand ? brand.brand_id : null, {
      name: name.slice(0, 120),
      type: b.personType,
      entityRef: typeof b.entityRef === "string" ? b.entityRef.slice(0, 200) : "",
      caresAbout: typeof b.caresAbout === "string" ? b.caresAbout.slice(0, 1000) : "",
      history: typeof b.history === "string" ? b.history.slice(0, 2000) : "",
      nextStep: typeof b.nextStep === "string" ? b.nextStep.slice(0, 500) : "",
      sentiment: typeof b.sentiment === "string" ? b.sentiment.slice(0, 40) : "",
      importance: Number(b.importance) || 0,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("echo saveProfile error:", err.message);
    return res.status(500).json({ error: "Failed to save that profile." });
  }
}

// DELETE /api/echo/profiles/:id — remove a relationship profile.
async function removeProfile(req, res) {
  try {
    const userId = req.user.userId;
    const { rowCount } = await db.query(
      "DELETE FROM echo_relationship_profiles WHERE profile_id = $1 AND user_id = $2",
      [req.params.id, userId],
    );
    if (rowCount === 0) return res.status(404).json({ error: "Profile not found." });
    return res.json({ ok: true });
  } catch (err) {
    console.error("echo removeProfile error:", err.message);
    return res.status(500).json({ error: "Failed to delete that profile." });
  }
}

// GET /api/echo/owner-profile — what Echo has learned about the owner.
async function getOwnerProfile(req, res) {
  try {
    const row = await echoContext.getOwnerProfileRow(req.user.userId);
    return res.json({
      profile: {
        riskTolerance: (row && row.risk_tolerance) || "",
        values: (row && row.core_values) || "",
        blindSpots: (row && row.blind_spots) || "",
        decisionPatterns: (row && row.decision_patterns) || "",
        preferences: (row && row.preferences) || "",
        communicationStyle: (row && row.communication_style) || "",
        goals: (row && row.goals) || "",
        updatedAt: (row && row.updated_at) || null,
      },
    });
  } catch (err) {
    console.error("echo getOwnerProfile error:", err.message);
    return res.status(500).json({ error: "Failed to load your profile." });
  }
}

// PUT /api/echo/owner-profile — the owner corrects/sets what Echo knows.
async function saveOwnerProfile(req, res) {
  try {
    const userId = req.user.userId;
    const b = req.body || {};
    // Overwrite exactly with the submitted values (empty string clears a field).
    const merged = await echoContext.setOwnerProfileRow(userId, {
      riskTolerance: typeof b.riskTolerance === "string" ? b.riskTolerance : "",
      values: typeof b.values === "string" ? b.values : "",
      blindSpots: typeof b.blindSpots === "string" ? b.blindSpots : "",
      decisionPatterns: typeof b.decisionPatterns === "string" ? b.decisionPatterns : "",
      preferences: typeof b.preferences === "string" ? b.preferences : "",
      communicationStyle: typeof b.communicationStyle === "string" ? b.communicationStyle : "",
      goals: typeof b.goals === "string" ? b.goals : "",
    });
    return res.json({
      ok: true,
      profile: {
        riskTolerance: merged.risk_tolerance || "",
        values: merged.core_values || "",
        blindSpots: merged.blind_spots || "",
        decisionPatterns: merged.decision_patterns || "",
        preferences: merged.preferences || "",
        communicationStyle: merged.communication_style || "",
        goals: merged.goals || "",
      },
    });
  } catch (err) {
    console.error("echo saveOwnerProfile error:", err.message);
    return res.status(500).json({ error: "Failed to save your profile." });
  }
}

module.exports = {
  listProfiles,
  saveProfile,
  removeProfile,
  getOwnerProfile,
  saveOwnerProfile,
};

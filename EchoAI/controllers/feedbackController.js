const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const { sendEmail } = require("../utils/email");
const { buildClient, getPublicBaseUrl } = require("../config/twilio");
const { decrypt } = require("../utils/encryption");
const {
  SURVEY_DESIGNER_SYSTEM_PROMPT,
  FEEDBACK_ANALYST_SYSTEM_PROMPT,
  buildSurveyGenerationPrompt,
  buildFeedbackAnalysisPrompt,
  validateSurveyQuestions,
  validateFeedbackReport,
} = require("../prompts/feedbackAnalysisPrompt");

const SURVEY_TYPES = ["post_purchase", "post_call", "post_chatbot", "general"];

// The fixed, ultra-short survey fired automatically after interactions. Kept
// deterministic (no AI call per interaction) so it is cheap and instant.
const AUTO_SURVEY_QUESTIONS = [
  {
    id: "satisfaction",
    question: "How satisfied were you with your experience? (1 = unhappy, 10 = delighted)",
    type: "rating",
  },
  { id: "comments", question: "What's the main reason for your score?", type: "text" },
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

function parseJsonResponse(text) {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const err = new Error("Failed to parse the AI response as JSON");
    err.statusCode = 502;
    throw err;
  }
}

function statusFor(err) {
  if (err.statusCode) return err.statusCode;
  if (typeof err.status === "number" && err.status >= 400) return 502;
  return 500;
}

async function getOwnedBrand(brandId, userId) {
  const result = await db.query(
    `SELECT b.brand_id, b.brand_name, b.brand_personality, b.voice_description,
            b.target_audience, b.user_id, u.email AS owner_email
     FROM brands b JOIN users u ON u.user_id = b.user_id
     WHERE b.brand_id = $1 AND b.user_id = $2`,
    [brandId, userId]
  );
  if (result.rows.length === 0) {
    const err = new Error("Brand not found");
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
}

/** Loads a survey owned by the user (join brands.user_id) or throws 404. */
async function getOwnedSurvey(surveyId, userId) {
  const result = await db.query(
    `SELECT s.*, b.brand_name, b.user_id
     FROM surveys s JOIN brands b ON b.brand_id = s.brand_id
     WHERE s.survey_id = $1 AND b.user_id = $2`,
    [surveyId, userId]
  );
  if (result.rows.length === 0) {
    const err = new Error("Survey not found");
    err.statusCode = 404;
    throw err;
  }
  return result.rows[0];
}

function ratingQuestionId(questions) {
  const q = (questions || []).find((x) => x.type === "rating");
  return q ? q.id : null;
}

/** Derives a 1-10 sentiment score from the rating answer, or null. */
function deriveSentiment(questions, answers) {
  const ratingId = ratingQuestionId(questions);
  if (!ratingId || !answers) return null;
  const raw = Number(answers[ratingId]);
  if (!Number.isFinite(raw)) return null;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Calls Anthropic, mapping any upstream failure to a 502. */
async function callAnthropic({ system, prompt, maxTokens = 2048 }) {
  try {
    return await anthropic.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    const wrapped = new Error(err.message || "AI request failed");
    wrapped.statusCode = 502;
    throw wrapped;
  }
}

async function aiGenerateSurvey(brand, surveyType) {
  const prompt = buildSurveyGenerationPrompt({ brand, surveyType });
  const response = await callAnthropic({
    system: SURVEY_DESIGNER_SYSTEM_PROMPT,
    prompt,
  });
  return validateSurveyQuestions(parseJsonResponse(extractText(response)));
}

// ---------------------------------------------------------------------------
// Survey creation & management — auth + lockout
// ---------------------------------------------------------------------------

/**
 * POST /api/feedback/survey  { brandId, surveyType }
 * AI-generates a 5-question, on-brand survey and saves it.
 */
async function createSurvey(req, res) {
  const userId = req.user.userId;
  const { brandId, surveyType } = req.body || {};

  if (!brandId || !surveyType) {
    return res.status(400).json({ error: "brandId and surveyType are required" });
  }
  if (!SURVEY_TYPES.includes(surveyType)) {
    return res.status(400).json({ error: `surveyType must be one of: ${SURVEY_TYPES.join(", ")}` });
  }

  try {
    const brand = await getOwnedBrand(brandId, userId);
    const questions = await aiGenerateSurvey(brand, surveyType);

    const inserted = await db.query(
      `INSERT INTO surveys (brand_id, survey_type, questions)
       VALUES ($1, $2, $3)
       RETURNING survey_id, brand_id, survey_type, questions, created_at`,
      [brandId, surveyType, JSON.stringify(questions)]
    );
    return res.status(201).json({ survey: inserted.rows[0] });
  } catch (err) {
    console.error("Create survey error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to create survey" });
  }
}

/**
 * PUT /api/feedback/survey/:surveyId  { questions }
 * Lets the owner customize a survey's questions.
 */
async function updateSurvey(req, res) {
  const userId = req.user.userId;
  const { surveyId } = req.params;
  const { questions } = req.body || {};

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: "A non-empty questions array is required" });
  }

  let cleaned;
  try {
    cleaned = validateSurveyQuestions({ questions });
  } catch {
    return res.status(400).json({ error: "The provided questions are invalid" });
  }

  try {
    await getOwnedSurvey(surveyId, userId);
    const updated = await db.query(
      `UPDATE surveys s SET questions = $1
       FROM brands b
       WHERE s.survey_id = $2 AND s.brand_id = b.brand_id AND b.user_id = $3
       RETURNING s.survey_id, s.brand_id, s.survey_type, s.questions, s.updated_at`,
      [JSON.stringify(cleaned), surveyId, userId]
    );
    return res.json({ survey: updated.rows[0] });
  } catch (err) {
    console.error("Update survey error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to update survey" });
  }
}

/**
 * GET /api/feedback/surveys/:brandId
 * Lists a brand's surveys with question count + response/answer counts.
 */
async function getSurveys(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    await getOwnedBrand(brandId, userId);
    const result = await db.query(
      `SELECT s.survey_id, s.survey_type, s.questions, s.created_at,
              COUNT(r.response_id) AS sent_count,
              COUNT(r.answers) AS response_count
       FROM surveys s
       LEFT JOIN survey_responses r ON r.survey_id = s.survey_id
       WHERE s.brand_id = $1
       GROUP BY s.survey_id
       ORDER BY s.created_at DESC`,
      [brandId]
    );
    const surveys = result.rows.map((row) => {
      const sent = Number(row.sent_count);
      const responses = Number(row.response_count);
      return {
        surveyId: row.survey_id,
        surveyType: row.survey_type,
        questions: row.questions,
        questionCount: Array.isArray(row.questions) ? row.questions.length : 0,
        sent,
        responses,
        responseRate: sent > 0 ? Math.round((responses / sent) * 100) : null,
        createdAt: row.created_at,
      };
    });
    return res.json({ count: surveys.length, surveys });
  } catch (err) {
    console.error("Get surveys error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load surveys" });
  }
}

// ---------------------------------------------------------------------------
// Sending — shared dispatch + manual route
// ---------------------------------------------------------------------------

/** Loads a brand's decrypted Twilio config, or null. */
async function getTwilioConfig(brandId) {
  const { rows } = await db.query(
    `SELECT account_sid, auth_token_encrypted, phone_number, connection_status
     FROM twilio_config WHERE brand_id = $1`,
    [brandId]
  );
  if (rows.length === 0 || rows[0].connection_status !== "connected") return null;
  return {
    accountSid: rows[0].account_sid,
    authToken: decrypt(rows[0].auth_token_encrypted),
    phoneNumber: rows[0].phone_number,
  };
}

function surveyLink(req, responseId) {
  const base = getPublicBaseUrl(req) || "";
  return `${base}/api/feedback/r/${responseId}`;
}

/**
 * Records a "sent" survey_responses row (answers NULL) and delivers the survey
 * link by the chosen channel. Returns { responseId, channel, delivered }.
 * Throws on a hard delivery failure for the manual route; auto-send swallows it.
 */
async function dispatchSurvey({ survey, brand, email, phone, channel, leadId, req }) {
  const useChannel = channel || (email ? "email" : phone ? "sms" : null);
  if (!useChannel) throw new Error("A recipient email or phone is required");
  if (useChannel === "email" && !email) throw new Error("An email is required for email delivery");
  if (useChannel === "sms" && !phone) throw new Error("A phone number is required for SMS delivery");

  const inserted = await db.query(
    `INSERT INTO survey_responses (survey_id, brand_id, lead_id, respondent_email, respondent_phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING response_id`,
    [survey.survey_id, brand.brand_id, leadId || null, email || null, phone || null]
  );
  const responseId = inserted.rows[0].response_id;
  const link = surveyLink(req, responseId);
  const brandName = brand.brand_name || "We";

  if (useChannel === "email") {
    const html = `
      <p>Hi there,</p>
      <p>Thanks for your time with ${escapeHtml(brandName)}. We'd love your quick feedback — it takes under a minute.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;background:#f59e0b;color:#111827;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;">Share your feedback</a></p>
      <p style="color:#6b7280;font-size:12px;">Or paste this link: ${escapeHtml(link)}</p>`;
    await sendEmail({ to: email, subject: `Quick feedback for ${brandName}`, html });
    return { responseId, channel: "email", delivered: true };
  }

  // SMS via the brand's own Twilio number.
  const cfg = await getTwilioConfig(brand.brand_id);
  if (!cfg) {
    const err = new Error("This brand has no connected Twilio number for SMS");
    err.statusCode = 400;
    throw err;
  }
  const client = buildClient(cfg.accountSid, cfg.authToken);
  await client.messages.create({
    to: phone,
    from: cfg.phoneNumber,
    body: `Thanks for choosing ${brandName}! We'd love your quick feedback: ${link}`,
  });
  return { responseId, channel: "sms", delivered: true };
}

/**
 * POST /api/feedback/send  { surveyId, email?, phone?, channel?, leadId? }
 * Manually sends a survey to a customer.
 */
async function sendSurvey(req, res) {
  const userId = req.user.userId;
  const { surveyId, email, phone, channel, leadId } = req.body || {};

  if (!surveyId || (!email && !phone)) {
    return res.status(400).json({ error: "surveyId and a recipient email or phone are required" });
  }

  try {
    const survey = await getOwnedSurvey(surveyId, userId);
    const brand = { brand_id: survey.brand_id, brand_name: survey.brand_name };

    // Never trust a client-supplied leadId: it must belong to the survey's brand.
    if (leadId) {
      const owned = await db.query(
        `SELECT 1 FROM leads WHERE lead_id = $1 AND brand_id = $2`,
        [leadId, survey.brand_id]
      );
      if (owned.rows.length === 0) {
        return res.status(404).json({ error: "Lead not found" });
      }
    }

    const result = await dispatchSurvey({ survey, brand, email, phone, channel, leadId, req });
    return res.status(201).json(result);
  } catch (err) {
    console.error("Send survey error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to send survey" });
  }
}

/**
 * Fire-and-forget survey after a key interaction. Never throws into the caller.
 * Finds or creates the auto (2-question) survey for the type, dedupes recent
 * sends to the same recipient, then delivers by email or SMS.
 */
async function autoSendSurvey({ brandId, surveyType, leadId, email, phone, channel }) {
  try {
    if (!brandId || (!email && !phone)) return;
    const type = SURVEY_TYPES.includes(surveyType) ? surveyType : "general";

    const brandRow = await db.query(
      "SELECT brand_id, brand_name FROM brands WHERE brand_id = $1",
      [brandId]
    );
    if (brandRow.rows.length === 0) return;
    const brand = brandRow.rows[0];

    // Find-or-create the reusable auto survey for this brand + type.
    let survey;
    const existing = await db.query(
      `SELECT * FROM surveys WHERE brand_id = $1 AND survey_type = $2
       ORDER BY created_at ASC LIMIT 1`,
      [brandId, type]
    );
    if (existing.rows.length > 0) {
      survey = existing.rows[0];
    } else {
      const created = await db.query(
        `INSERT INTO surveys (brand_id, survey_type, questions)
         VALUES ($1, $2, $3) RETURNING *`,
        [brandId, type, JSON.stringify(AUTO_SURVEY_QUESTIONS)]
      );
      survey = created.rows[0];
    }

    // Dedupe: don't re-survey the same recipient within 24h.
    const dupe = await db.query(
      `SELECT 1 FROM survey_responses
       WHERE survey_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'
         AND ( (lead_id IS NOT NULL AND lead_id = $2)
            OR (respondent_email IS NOT NULL AND respondent_email = $3)
            OR (respondent_phone IS NOT NULL AND respondent_phone = $4) )
       LIMIT 1`,
      [survey.survey_id, leadId || null, email || null, phone || null]
    );
    if (dupe.rows.length > 0) return;

    await dispatchSurvey({ survey, brand, email, phone, channel, leadId });
  } catch (err) {
    console.error("Auto-send survey failed:", err.message);
  }
}

// ---------------------------------------------------------------------------
// Public response capture — NO auth (customers respond)
// ---------------------------------------------------------------------------

/** GET /api/feedback/r/:responseId — server-rendered survey form. */
async function renderSurveyPage(req, res) {
  const { responseId } = req.params;
  try {
    const result = await db.query(
      `SELECT r.response_id, r.answers, s.questions, b.brand_name
       FROM survey_responses r
       JOIN surveys s ON s.survey_id = r.survey_id
       JOIN brands b ON b.brand_id = r.brand_id
       WHERE r.response_id = $1`,
      [responseId]
    );
    if (result.rows.length === 0) {
      return res.status(404).type("html").send(pageShell("Survey not found", "<p>This survey link is invalid.</p>"));
    }
    const row = result.rows[0];
    if (row.answers) {
      return res.type("html").send(
        pageShell("Thank you!", "<p>You've already shared your feedback. Thank you!</p>")
      );
    }

    const questions = Array.isArray(row.questions) ? row.questions : [];
    const fields = questions
      .map((q) => {
        const label = `<label style="display:block;font-weight:600;margin:18px 0 6px;">${escapeHtml(q.question)}</label>`;
        if (q.type === "rating") {
          const opts = Array.from({ length: 10 }, (_, i) => i + 1)
            .map((n) => `<option value="${n}">${n}</option>`)
            .join("");
          return `${label}<select name="${escapeHtml(q.id)}" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #d1d5db;"><option value="" disabled selected>Choose 1-10</option>${opts}</select>`;
        }
        return `${label}<textarea name="${escapeHtml(q.id)}" rows="3" style="width:100%;padding:10px;border-radius:8px;border:1px solid #d1d5db;"></textarea>`;
      })
      .join("");

    const form = `
      <h1 style="font-size:20px;margin:0 0 4px;">${escapeHtml(row.brand_name || "We")} value your feedback</h1>
      <p style="color:#6b7280;margin:0 0 8px;">It takes under a minute.</p>
      <form method="POST" action="/api/feedback/r/${escapeHtml(responseId)}">
        ${fields}
        <button type="submit" style="margin-top:22px;background:#f59e0b;color:#111827;border:none;padding:12px 22px;border-radius:8px;font-weight:700;cursor:pointer;">Submit feedback</button>
      </form>`;
    return res.type("html").send(pageShell("Share your feedback", form));
  } catch (err) {
    console.error("Render survey page error:", err.message);
    return res.status(500).type("html").send(pageShell("Error", "<p>Something went wrong. Please try again later.</p>"));
  }
}

/**
 * POST /api/feedback/r/:responseId — record a customer response (public).
 * Accepts form-encoded (from the page) or JSON. Idempotent: only fills a row
 * whose answers are still NULL.
 */
async function recordResponse(req, res) {
  const { responseId } = req.params;
  const wantsJson = req.is("application/json");
  try {
    const found = await db.query(
      `SELECT r.response_id, r.answers, s.questions
       FROM survey_responses r JOIN surveys s ON s.survey_id = r.survey_id
       WHERE r.response_id = $1`,
      [responseId]
    );
    if (found.rows.length === 0) {
      if (wantsJson) return res.status(404).json({ error: "Survey not found" });
      return res.status(404).type("html").send(pageShell("Survey not found", "<p>This survey link is invalid.</p>"));
    }
    const row = found.rows[0];
    const questions = Array.isArray(row.questions) ? row.questions : [];

    // Collect answers keyed by question id from whichever body shape arrived.
    const body = req.body || {};
    const answers = {};
    questions.forEach((q) => {
      if (body[q.id] !== undefined && String(body[q.id]).trim() !== "") {
        answers[q.id] = body[q.id];
      }
    });

    if (Object.keys(answers).length === 0) {
      if (wantsJson) return res.status(400).json({ error: "No answers provided" });
      return res.status(400).type("html").send(pageShell("Missing answers", "<p>Please answer at least one question.</p>"));
    }

    const sentiment = deriveSentiment(questions, answers);

    // Only fill an unanswered row (idempotent against double-submits).
    const updated = await db.query(
      `UPDATE survey_responses
       SET answers = $1, sentiment_score = $2, responded_at = NOW()
       WHERE response_id = $3 AND answers IS NULL
       RETURNING response_id`,
      [JSON.stringify(answers), sentiment, responseId]
    );

    // The atomic `WHERE answers IS NULL` is the source of truth: the row was
    // confirmed to exist above, so a zero-row update means another request
    // already filled it (race-safe against concurrent double-submits).
    if (updated.rows.length === 0) {
      if (wantsJson) return res.status(409).json({ error: "This survey was already submitted" });
      return res.type("html").send(pageShell("Thank you!", "<p>You've already shared your feedback. Thank you!</p>"));
    }

    if (wantsJson) return res.status(201).json({ responseId, recorded: true });
    return res.type("html").send(
      pageShell("Thank you!", "<p>Thank you for your feedback — it helps us improve!</p>")
    );
  } catch (err) {
    console.error("Record response error:", err.message);
    if (wantsJson) return res.status(500).json({ error: "Failed to record response" });
    return res.status(500).type("html").send(pageShell("Error", "<p>Something went wrong. Please try again later.</p>"));
  }
}

function pageShell(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)}</title></head>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px;color:#111827;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;">
  ${inner}
  </div></body></html>`;
}

// ---------------------------------------------------------------------------
// Analysis + dashboard — auth + lockout
// ---------------------------------------------------------------------------

/**
 * Pulls answered responses from the last 30 days, runs the Feedback Analyst,
 * persists a feedback_reports row, and returns it. Returns null when there's
 * nothing to analyze. Throws (502) on AI failure.
 */
async function generateFeedbackReportForBrand(brand) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await db.query(
    `SELECT r.answers, r.sentiment_score, s.questions
     FROM survey_responses r JOIN surveys s ON s.survey_id = r.survey_id
     WHERE r.brand_id = $1 AND r.answers IS NOT NULL AND r.created_at >= $2
     ORDER BY r.created_at DESC`,
    [brand.brand_id, periodStart]
  );
  if (result.rows.length === 0) return null;

  // Build a question-text-keyed view for the analyst.
  const responses = result.rows.map((row) => {
    const qById = {};
    (Array.isArray(row.questions) ? row.questions : []).forEach((q) => {
      qById[q.id] = q.question;
    });
    const answers = {};
    Object.entries(row.answers || {}).forEach(([id, val]) => {
      answers[qById[id] || id] = val;
    });
    return { score: row.sentiment_score, answers };
  });

  const prompt = buildFeedbackAnalysisPrompt({ brand, responses });
  const aiResponse = await callAnthropic({
    system: FEEDBACK_ANALYST_SYSTEM_PROMPT,
    prompt,
    maxTokens: 3072,
  });
  const report = validateFeedbackReport(parseJsonResponse(extractText(aiResponse)));

  const scores = result.rows
    .map((r) => r.sentiment_score)
    .filter((s) => typeof s === "number");
  const avg = scores.length
    ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
    : null;

  const inserted = await db.query(
    `INSERT INTO feedback_reports
       (brand_id, analysis_period_start, analysis_period_end, total_responses,
        average_sentiment, themes, recommendations, full_report)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      brand.brand_id,
      periodStart,
      periodEnd,
      result.rows.length,
      avg,
      JSON.stringify(report.themes),
      JSON.stringify(report.recommendations),
      report.reportText,
    ]
  );

  return { ...inserted.rows[0], analysis: report };
}

/**
 * POST /api/feedback/analyze  { brandId }
 * Generates and returns a fresh feedback-analysis report.
 */
async function analyzeFeedback(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.body || {};
  if (!brandId) return res.status(400).json({ error: "brandId is required" });

  try {
    const brand = await getOwnedBrand(brandId, userId);
    const report = await generateFeedbackReportForBrand(brand);
    if (!report) {
      return res.status(200).json({
        report: null,
        message: "No survey responses in the last 30 days yet. Send some surveys to generate a report.",
      });
    }
    return res.status(201).json({ report });
  } catch (err) {
    console.error("Analyze feedback error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to analyze feedback" });
  }
}

/**
 * GET /api/feedback/dashboard/:brandId
 * Aggregate stats for the Feedback Dashboard tab.
 */
async function getFeedbackDashboard(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    await getOwnedBrand(brandId, userId);

    const stats = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE answers IS NOT NULL AND created_at >= date_trunc('month', NOW())) AS responses_this_month,
         COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS sent_this_month,
         AVG(sentiment_score) FILTER (WHERE answers IS NOT NULL) AS avg_sentiment,
         COUNT(*) FILTER (WHERE answers IS NOT NULL AND sentiment_score >= 8) AS positive,
         COUNT(*) FILTER (WHERE answers IS NOT NULL AND sentiment_score BETWEEN 6 AND 7) AS neutral,
         COUNT(*) FILTER (WHERE answers IS NOT NULL AND sentiment_score < 6) AS negative,
         COUNT(*) FILTER (WHERE answers IS NOT NULL) AS total_responses
       FROM survey_responses
       WHERE brand_id = $1`,
      [brandId]
    );
    const s = stats.rows[0];

    const sentScored = Number(s.positive) + Number(s.neutral) + Number(s.negative);
    const pct = (n) => (sentScored > 0 ? Math.round((Number(n) / sentScored) * 100) : 0);

    const latestReport = await db.query(
      `SELECT report_id, analysis_period_start, analysis_period_end, total_responses,
              average_sentiment, themes, recommendations, full_report, created_at
       FROM feedback_reports WHERE brand_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [brandId]
    );

    const sentThisMonth = Number(s.sent_this_month);
    const responsesThisMonth = Number(s.responses_this_month);

    return res.json({
      averageSatisfaction:
        s.avg_sentiment != null ? Math.round(Number(s.avg_sentiment) * 10) / 10 : null,
      totalResponsesThisMonth: responsesThisMonth,
      totalResponses: Number(s.total_responses),
      responseRate: sentThisMonth > 0 ? Math.round((responsesThisMonth / sentThisMonth) * 100) : null,
      sentimentBreakdown: {
        positive: pct(s.positive),
        neutral: pct(s.neutral),
        negative: pct(s.negative),
      },
      latestReport: latestReport.rows[0] || null,
    });
  } catch (err) {
    console.error("Feedback dashboard error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load dashboard" });
  }
}

/**
 * GET /api/feedback/responses/:brandId
 * All individual responses for the Responses tab (newest first).
 */
async function getResponses(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    await getOwnedBrand(brandId, userId);
    const result = await db.query(
      `SELECT r.response_id, r.respondent_email, r.respondent_phone, r.answers,
              r.sentiment_score, r.responded_at, r.created_at, s.survey_type, s.questions
       FROM survey_responses r JOIN surveys s ON s.survey_id = r.survey_id
       WHERE r.brand_id = $1 AND r.answers IS NOT NULL
       ORDER BY r.responded_at DESC NULLS LAST, r.created_at DESC`,
      [brandId]
    );
    const responses = result.rows.map((row) => {
      const qById = {};
      (Array.isArray(row.questions) ? row.questions : []).forEach((q) => {
        qById[q.id] = q.question;
      });
      const answers = Object.entries(row.answers || {}).map(([id, val]) => ({
        question: qById[id] || id,
        answer: val,
      }));
      return {
        responseId: row.response_id,
        respondentEmail: row.respondent_email,
        respondentPhone: row.respondent_phone,
        sentimentScore: row.sentiment_score,
        interactionType: row.survey_type,
        respondedAt: row.responded_at || row.created_at,
        answers,
      };
    });
    return res.json({ count: responses.length, responses });
  } catch (err) {
    console.error("Get responses error:", err.message);
    return res.status(statusFor(err)).json({ error: err.message || "Failed to load responses" });
  }
}

module.exports = {
  createSurvey,
  updateSurvey,
  getSurveys,
  sendSurvey,
  recordResponse,
  renderSurveyPage,
  autoSendSurvey,
  analyzeFeedback,
  generateFeedbackReportForBrand,
  getFeedbackDashboard,
  getResponses,
};

const db = require("../config/db");
const { anthropic, MODEL } = require("../config/anthropic");
const {
  buildLeadQualificationPrompt,
  LEAD_SCORING_PROMPT,
} = require("../prompts/leadQualificationPrompt");
const emailController = require("./emailController");
const pushController = require("./pushController");
const mobilePushController = require("./mobilePushController");

const VALID_TEMPERATURES = ["tire_kicker", "warm", "hot"];

function extractText(response) {
  return (response.content || [])
    .map((block) => block.text || "")
    .join("")
    .trim();
}

/**
 * Normalizes stored conversation history into Anthropic message format. Ensures
 * the first message is from the user (Anthropic requires this), seeding a minimal
 * opening turn when the stored history begins with the assistant's greeting.
 */
function toAnthropicMessages(messages) {
  const mapped = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }));
  if (mapped.length > 0 && mapped[0].role === "assistant") {
    mapped.unshift({ role: "user", content: "Hello" });
  }
  return mapped;
}

async function getReply(systemPrompt, anthropicMessages) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: anthropicMessages,
  });
  return extractText(response);
}

/**
 * Asks the model to classify the lead temperature from the conversation.
 * Returns one of VALID_TEMPERATURES, or null if it can't be determined.
 */
async function scoreLead(messages) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 10,
    system: LEAD_SCORING_PROMPT,
    messages: toAnthropicMessages(messages),
  });
  const text = extractText(response).toLowerCase();
  if (text.includes("hot")) return "hot";
  if (text.includes("warm")) return "warm";
  if (text.includes("tire")) return "tire_kicker";
  return null;
}

async function logInteraction(leadId, details) {
  await db.query(
    `INSERT INTO crm_interactions (lead_id, interaction_type, interaction_details)
     VALUES ($1, 'chatbot_conversation', $2::jsonb)`,
    [leadId, JSON.stringify(details)]
  );
}

/**
 * Starts the qualification conversation for a freshly created lead: generates the
 * chatbot's opening greeting, stores it in the lead's conversation history, and
 * logs the interaction. Returns the greeting text.
 *
 * Used by the lead controller's createLead. Throws on AI failure so the caller
 * can decide how to handle it.
 */
async function startConversation(lead, brand) {
  const systemPrompt = buildLeadQualificationPrompt(brand);
  const greeting = await getReply(systemPrompt, [
    { role: "user", content: "A new prospect has just arrived. Greet them and begin the conversation." },
  ]);

  const history = [{ role: "assistant", content: greeting, at: new Date().toISOString() }];

  await db.query(
    "UPDATE leads SET conversation_history = $1::jsonb WHERE lead_id = $2",
    [JSON.stringify(history), lead.lead_id]
  );

  await logInteraction(lead.lead_id, { direction: "assistant", message: greeting });

  return greeting;
}

/**
 * POST /api/leads/chat  (PUBLIC — prospects are not authenticated)
 * Drives the lead qualification conversation.
 *
 * Request body:
 *  - leadId  (required): the lead/prospect this conversation belongs to
 *  - message (required): the prospect's latest message
 *
 * Behavior: appends the message, gets the chatbot's reply, re-scores the lead
 * temperature, persists conversation state, and logs the exchange to the CRM.
 * The internal temperature score is NOT returned to the prospect.
 */
async function chat(req, res) {
  const { leadId, message } = req.body;

  if (!leadId || !message) {
    return res.status(400).json({ error: "leadId and message are required" });
  }

  try {
    // Load the lead and its brand (for brand-aware tone).
    const result = await db.query(
      `SELECT l.lead_id, l.brand_id, l.conversation_history,
              l.lead_name, l.email AS lead_email, l.phone,
              b.brand_name, b.brand_personality, b.voice_description, b.target_audience,
              u.email AS owner_email, u.user_id AS owner_user_id
       FROM leads l
       JOIN brands b ON b.brand_id = l.brand_id
       JOIN users u ON u.user_id = b.user_id
       WHERE l.lead_id = $1`,
      [leadId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const row = result.rows[0];
    const brand = {
      brand_name: row.brand_name,
      brand_personality: row.brand_personality,
      voice_description: row.voice_description,
      target_audience: row.target_audience,
    };

    const messages = Array.isArray(row.conversation_history) ? row.conversation_history : [];
    const systemPrompt = buildLeadQualificationPrompt(brand);

    messages.push({ role: "user", content: message, at: new Date().toISOString() });
    const reply = await getReply(systemPrompt, toAnthropicMessages(messages));
    messages.push({ role: "assistant", content: reply, at: new Date().toISOString() });

    const temperature = await scoreLead(messages);

    if (temperature && VALID_TEMPERATURES.includes(temperature)) {
      await db.query(
        "UPDATE leads SET conversation_history = $1::jsonb, temperature = $2 WHERE lead_id = $3",
        [JSON.stringify(messages), temperature, leadId]
      );
    } else {
      await db.query(
        "UPDATE leads SET conversation_history = $1::jsonb WHERE lead_id = $2",
        [JSON.stringify(messages), leadId]
      );
    }

    await logInteraction(leadId, {
      direction: "exchange",
      userMessage: message,
      botReply: reply,
      scoredTemperature: temperature || null,
    });

    // Notify the business owner immediately whenever a lead turns hot.
    // Best-effort: never block or fail the chat response on email delivery.
    if (temperature === "hot" && row.owner_email) {
      const summary = messages
        .filter((m) => m.role === "user")
        .slice(-5)
        .map((m) => m.content)
        .join(" ");
      emailController
        .sendHotLeadAlert({
          ownerEmail: row.owner_email,
          brandName: row.brand_name,
          lead: { lead_name: row.lead_name, email: row.lead_email, phone: row.phone },
          summary,
        })
        .catch((err) => console.error("Hot lead alert failed:", err.message));

      // Also push a real-time notification to the owner's installed devices so
      // they can act the instant a lead turns hot. Best-effort, never blocks.
      if (row.owner_user_id) {
        const leadLabel = row.lead_name || "A new lead";
        const hotBody = `${leadLabel} just turned HOT${row.brand_name ? ` for ${row.brand_name}` : ""}. Reach out now.`;
        pushController
          .sendPushToUser(row.owner_user_id, {
            title: "🔥 Hot lead!",
            body: hotBody,
            url: "/dashboard",
            tag: `hot-lead-${leadId}`,
          })
          .catch((err) => console.error("Hot lead push failed:", err.message));

        // Mirror the alert to the owner's native mobile devices via FCM.
        mobilePushController
          .sendToUser(row.owner_user_id, {
            title: "🔥 Hot lead!",
            body: hotBody,
            data: { type: "hot_lead", leadId: String(leadId) },
          })
          .catch((err) => console.error("Hot lead mobile push failed:", err.message));
      }
    }

    return res.json({ leadId, reply });
  } catch (err) {
    console.error("Chatbot error:", err.message);
    return res.status(500).json({ error: "Chatbot conversation failed" });
  }
}

module.exports = { chat, startConversation };

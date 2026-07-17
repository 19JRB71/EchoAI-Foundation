/**
 * Sage V2 P1 — customer-facing copy for the consolidated weekly Sage briefing
 * and the "flying blind" nudge.
 *
 * ============================ DRAFT COPY ONLY ============================
 * Per the operating model, ALL strings in this file are engineering
 * placeholders. Final wording will be drafted by ChatGPT (Creative Director)
 * and approved by the CEO, then dropped in here verbatim before the
 * SAGE_V2_WEEKLY_BRIEFING / SAGE_V2_CONTEXT features are enabled for users.
 * Nothing in this file is rendered while those flags are off (default).
 * =========================================================================
 */

const WEEKLY_BRIEFING_COPY = {
  title: "[DRAFT] Your Weekly Briefing from Sage",
  intro:
    "[DRAFT] Here's everything that happened across your marketing this week, in one place.",
  sections: {
    performance: {
      title: "[DRAFT] How your marketing performed",
      empty: "[DRAFT] No campaign activity was recorded this week.",
    },
    intelligence: {
      title: "[DRAFT] What Sage learned about your customers",
      empty: "[DRAFT] Not enough new customer data this week to add insights.",
    },
    roi: {
      title: "[DRAFT] Your return on investment",
      empty: "[DRAFT] No ROI snapshot was produced this week.",
    },
    autopilot: {
      title: "[DRAFT] What Autopilot did for you",
      empty: "[DRAFT] Autopilot did not run this week.",
    },
    competitors: {
      title: "[DRAFT] What your competitors are doing",
      empty: "[DRAFT] No competitor activity report this week.",
    },
    feedback: {
      title: "[DRAFT] What your customers are saying",
      empty: "[DRAFT] No new customer feedback was analyzed this week.",
    },
  },
  unavailableNote:
    "[DRAFT] Some of this week's reports weren't available when this briefing was built; the sections above reflect only real data.",
};

const FLYING_BLIND_COPY = {
  // Sage page indicator.
  banner:
    "[DRAFT] Your AI team is working without your approved Company Profile. Approve it on the Sage page so every recommendation is grounded in your real business facts.",
  // Echo's one-line nudge (spoken/briefing) — one nag at a time, like setup reminders.
  echoNudge:
    "[DRAFT] One more thing: your Company Profile hasn't been approved yet, so I'm working without your vetted business facts — approving it on the Sage page will make everything I do more accurate.",
};

module.exports = { WEEKLY_BRIEFING_COPY, FLYING_BLIND_COPY };

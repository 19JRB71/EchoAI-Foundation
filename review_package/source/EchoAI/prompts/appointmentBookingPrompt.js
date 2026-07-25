/**
 * AI Appointment Booking prompts.
 *
 * buildAppointmentSchedulerPrompt(brand, { slots, channel }) returns a block of
 * scheduling guidance that is APPENDED to the website chatbot / phone agent's
 * existing system prompt once a lead turns hot. It does NOT replace the base
 * persona — it gives the agent the brand's REAL open slots and tells it how to
 * transition naturally into booking. The slots are genuine availability computed
 * server-side (working hours minus existing appointments, blackout blocks, and
 * Google Calendar busy times), so the agent never invents times.
 *
 * Each slot is { start: ISO string, end: ISO string, label: human-friendly }.
 *
 * channel:
 *  - "chat": typed widget. The agent confirms a booking deterministically by
 *    appending a hidden [[BOOK:<ISO>]] token (stripped server-side before the
 *    reply reaches the visitor), so an actual appointment row is created only on
 *    an explicit, machine-readable confirmation — never on a guess.
 *  - "phone": spoken call. No token (it would be read aloud by TTS); the agent
 *    offers real times verbally and the booking is captured at call end.
 */

function buildAppointmentSchedulerPrompt(brand, opts = {}) {
  const { slots = [], channel = "chat" } = opts;
  const businessName = (brand && brand.brand_name) || "the business";
  const spoken = channel === "phone";
  const top = Array.isArray(slots) ? slots.slice(0, 3) : [];

  const parts = [
    "",
    "--- APPOINTMENT BOOKING ---",
    `This person is a strong, ready-to-act lead. A key goal now is to book them a concrete appointment with ${businessName}.`,
  ];

  if (top.length > 0) {
    parts.push(
      "These are the business's REAL open times. Offer two or three of them naturally — never invent or guess times, and never offer a time that is not on this list:",
    );
    parts.push(top.map((s, i) => `${i + 1}. ${s.label}`).join("\n"));
    parts.push(
      [
        "How to book:",
        "1. Warmly suggest booking and offer two or three of the open times above.",
        "2. Let them pick one, or ask what works if none fit.",
        "3. Make sure you have their name and " +
          (spoken
            ? "the best email or phone number for the confirmation."
            : "an email or phone number so the confirmation can be sent."),
        "4. When they choose a specific time, clearly confirm the exact day and time back to them.",
      ].join("\n"),
    );

    if (!spoken) {
      // Deterministic booking signal for the typed widget. The token is stripped
      // server-side and never shown to the visitor; the appointment is only
      // created when the ISO exactly matches one of the offered slots.
      parts.push(
        [
          "BOOKING CONFIRMATION (very important):",
          "The moment the visitor clearly agrees to a specific time above, append to the END of that same reply, on its own line, the exact token:",
          "[[BOOK:<ISO>]]",
          "replacing <ISO> with the matching ISO timestamp from this list. Never say the ISO or the token out loud — they are an invisible system signal only. Use it at most once.",
          top.map((s) => `- ${s.label} -> ${s.start}`).join("\n"),
        ].join("\n"),
      );
    }
  } else {
    parts.push(
      "The business has not published open times yet, so do not promise a specific slot. Instead, collect the lead's name and best email or phone number and let them know someone will reach out shortly to schedule.",
    );
  }

  if (spoken) {
    parts.push(
      "Keep it to one short spoken sentence at a time, just like the rest of the call.",
    );
  } else {
    parts.push(
      "Keep the scheduling offer short and friendly — one or two sentences.",
    );
  }

  parts.push(
    "Do not mention calendars, availability systems, or that this is automated. Just book like a helpful human would.",
  );

  return parts.join("\n");
}

/**
 * Used at the end of a phone call (outcome = appointment_booked) to map the
 * spoken agreement to one of the brand's real open slots. The model must answer
 * with the exact ISO of the agreed slot, or "none".
 */
function buildPhoneBookingExtractionPrompt(slots) {
  const list = (Array.isArray(slots) ? slots : [])
    .map((s) => `- ${s.label} -> ${s.start}`)
    .join("\n");
  return [
    "You are reviewing a phone call transcript where the caller may have agreed to book an appointment.",
    "Here are the only valid open time slots (label -> ISO):",
    list || "(none)",
    "",
    "If the caller clearly agreed to ONE specific slot from the list, respond with ONLY that slot's exact ISO timestamp.",
    "If no specific slot from the list was clearly agreed, respond with exactly: none",
    "Respond with the ISO or 'none' and nothing else.",
  ].join("\n");
}

module.exports = {
  buildAppointmentSchedulerPrompt,
  buildPhoneBookingExtractionPrompt,
};

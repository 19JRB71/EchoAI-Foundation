/**
 * ROI value model — the industry-average assumptions behind every ROI figure.
 *
 * These are transparent, documented estimates (NOT live market data). They are
 * surfaced to the customer in the dashboard's "How we calculate this" note so the
 * numbers are honest rather than a black box. Tune in one place.
 */

const ROI_MODEL = {
  // Estimated business value of a captured lead, by temperature. Hot leads are
  // sales-ready and worth substantially more than an early-stage contact.
  leadValue: 75,
  hotLeadValue: 350,

  // Blended hourly cost of the marketing labor EchoAI automates away.
  hourlyRate: 60,

  // Typical monthly retainer of a small marketing agency EchoAI replaces.
  agencyMonthlyRetainer: 4000,

  // Estimated hours of manual work saved per automated task.
  hoursPerSocialPost: 0.75,
  hoursPerEmail: 0.5,
  hoursPerCampaign: 4,
  hoursPerLead: 0.5,

  // Estimated organic reach per published social post.
  reachPerPost: 250,

  // Fallback monthly plan price used for the ROI ratio when a customer is on the
  // free tier (so the % is still meaningful and comparable to a paid plan).
  fallbackMonthlyPrice: 49,

  // --- Advanced ROI Dashboard (multi-channel dollar attribution) ---
  // Estimated average revenue from a single converted customer. Drives the
  // revenue attributed to each channel's conversions in the advanced dashboard.
  revenuePerConversion: 1200,

  // Per-unit channel cost estimates used to attribute real outbound spend to the
  // SMS, phone, and email channels (Facebook spend comes from real analytics).
  smsCostPerMessage: 0.0079, // per outbound SMS segment (carrier/Twilio average)
  phoneCostPerMinute: 0.013, // per outbound/inbound call minute (Twilio average)
  emailCostPerSend: 0.001, // per delivered marketing email (ESP average)
};

module.exports = { ROI_MODEL };

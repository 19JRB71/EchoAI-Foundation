// Demo account seeder — "Premier Auto Group", three tiers.
//
// Populates THREE brands (all owned by the platform admin, is_demo = true) — one
// per sellable tier (Starter, Professional, Enterprise) — with realistic,
// tier-appropriate datasets so a sales prospect sees exactly what THAT plan
// unlocks. The data is STATIC fixtures (no AI / DALL-E calls) — appropriate for a
// demo, and it never mixes with real customer data (that lives under other
// user_ids) nor sends anything (background workers skip is_demo brands).
//
// Each demo brand is tagged with `demo_tier`; the amount of child data scales
// with the tier, and higher-tier-only artifacts (ad creatives, competitor
// intelligence, surveys, etc.) are only seeded for the tiers that unlock them —
// so the client's existing feature gating renders everything above the brand's
// tier as a locked upgrade teaser.
//
// seedDemo() is idempotent: it deletes ALL existing demo brands (cascading to
// child rows) and recreates the three, so Reset always returns to a clean state.

const db = require("../config/db");

const DEMO_BUSINESS_DEFAULT = "Premier Auto Group";

const J = (v) => JSON.stringify(v);

// The tiers to seed, weakest first, and their rank for gating comparisons.
const TIER_ORDER = ["starter", "pro", "enterprise"];
const TIER_RANK = { starter: 1, pro: 2, enterprise: 3 };

// Per-tier data volume. Higher tiers get a fuller dataset so the demo visibly
// grows richer as the prospect moves up the plans.
const TIER_SCALE = {
  starter: { hot: 8, warm: 10, tire: 6, campaigns: 2, posts: 6 },
  pro: { hot: 12, warm: 15, tire: 9, campaigns: 3, posts: 10 },
  enterprise: { hot: 15, warm: 20, tire: 12, campaigns: 4, posts: 15 },
};

// ---- relative time helpers -------------------------------------------------
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function iso(offsetMs) {
  return new Date(Date.now() + offsetMs).toISOString();
}

// Build the "Good morning" briefing Echo reads aloud when the demo opens.
function buildMorningBriefing(businessName, prospectName) {
  const greet = prospectName ? `Good morning ${prospectName}.` : "Good morning.";
  return (
    `${greet} Here is your daily briefing for ${businessName}. You had 23 new ` +
    `leads come in overnight from your four Facebook campaigns. Atlas generated ` +
    `94 clicks yesterday at an average cost of $1.12 per click. Pulse followed up ` +
    `with 14 warm leads automatically and 3 of them just scheduled test drives ` +
    `for this week. You have a 10 o'clock appointment with David who is very ` +
    `interested in a 2024 F-150, a 2 o'clock with Maria looking at a pre-owned ` +
    `SUV, and a 4 o'clock trade-in evaluation with James. Your hottest lead right ` +
    `now is Marcus Reed — he has messaged twice about zero-down financing on a ` +
    `Silverado. That's your day. Let's sell some cars.`
  );
}

// ---- lead fixtures ---------------------------------------------------------
const HOT_LEADS = [
  ["Marcus Reed", "marcus.reed@gmail.com", "(407) 555-0142", "2024 Chevrolet Silverado", "zero-down financing"],
  ["Ashley Nguyen", "ashley.nguyen@outlook.com", "(407) 555-0177", "2024 Ford F-150", "trade-in value"],
  ["David Alvarez", "david.alvarez@gmail.com", "(407) 555-0119", "2024 Ford F-150", "test drive this week"],
  ["Priya Patel", "priya.patel@yahoo.com", "(321) 555-0163", "2024 Toyota RAV4", "monthly payment"],
  ["Jerome Wallace", "jerome.w@gmail.com", "(407) 555-0188", "2023 Chevrolet Tahoe", "financing pre-approval"],
  ["Samantha Cruz", "sam.cruz@gmail.com", "(321) 555-0155", "2024 Toyota Camry", "color availability"],
  ["Brian Foster", "bfoster@gmail.com", "(407) 555-0134", "2024 Jeep Wrangler", "out-the-door price"],
  ["Nicole Bennett", "nicole.bennett@icloud.com", "(407) 555-0198", "pre-owned SUV under 30k", "test drive"],
  ["Tyler Brooks", "tyler.brooks@gmail.com", "(321) 555-0126", "2024 Ford Mustang", "APR rate"],
  ["Grace Kim", "grace.kim@gmail.com", "(407) 555-0171", "2024 Honda CR-V", "lease vs buy"],
  ["Omar Haddad", "omar.haddad@gmail.com", "(407) 555-0149", "2023 Chevrolet Silverado", "commercial fleet pricing"],
  ["Rachel Green", "rachel.green@gmail.com", "(321) 555-0182", "2024 Toyota Highlander", "third-row seating"],
  ["Kevin Doyle", "kevin.doyle@gmail.com", "(407) 555-0113", "2024 Ford F-150", "towing package"],
  ["Isabella Rossi", "bella.rossi@gmail.com", "(407) 555-0195", "2024 Toyota Corolla", "first car financing"],
  ["Damon Carter", "damon.carter@gmail.com", "(321) 555-0107", "2023 Ford Explorer", "trade-in a 2018 Altima"],
];

const WARM_LEADS = [
  ["Laura Mitchell", "laura.m@gmail.com", "(407) 555-0201", "2024 Honda Accord", "waiting on tax refund"],
  ["Chris Powell", "chris.powell@gmail.com", "(321) 555-0212", "pre-owned truck", "comparing dealers"],
  ["Megan Scott", "megan.scott@gmail.com", "(407) 555-0223", "2024 Toyota RAV4", "needs spouse approval"],
  ["Andre Thomas", "andre.t@gmail.com", "(407) 555-0234", "2023 Chevrolet Tahoe", "checking insurance cost"],
  ["Vanessa Long", "vanessa.long@gmail.com", "(321) 555-0245", "2024 Honda CR-V", "not ready until next month"],
  ["Patrick Hughes", "patrick.h@gmail.com", "(407) 555-0256", "2024 Ford F-150", "financing questions"],
  ["Dana White", "dana.white@gmail.com", "(407) 555-0267", "2024 Toyota Camry", "wants a lower payment"],
  ["Felix Moreno", "felix.moreno@gmail.com", "(321) 555-0278", "pre-owned SUV", "still browsing"],
  ["Holly Parker", "holly.parker@gmail.com", "(407) 555-0289", "2024 Jeep Wrangler", "timing in 3 weeks"],
  ["Sean Murphy", "sean.murphy@gmail.com", "(407) 555-0290", "2023 Ford Explorer", "trade-in questions"],
  ["Tara Simmons", "tara.simmons@gmail.com", "(321) 555-0301", "2024 Honda Accord", "credit check hesitation"],
  ["Louis Bell", "louis.bell@gmail.com", "(407) 555-0312", "2024 Toyota Highlander", "wants weekend appointment"],
  ["Erica Flores", "erica.flores@gmail.com", "(407) 555-0323", "2024 Toyota Corolla", "budget conscious"],
  ["Gavin Reed", "gavin.reed@gmail.com", "(321) 555-0334", "2023 Chevrolet Silverado", "comparing to RAM"],
  ["Naomi Clark", "naomi.clark@gmail.com", "(407) 555-0345", "2024 Honda CR-V", "waiting on financing"],
  ["Derek Stone", "derek.stone@gmail.com", "(407) 555-0356", "pre-owned truck under 25k", "checking availability"],
  ["Sophia Turner", "sophia.turner@gmail.com", "(321) 555-0367", "2024 Toyota RAV4", "color preference"],
  ["Marcus Hill", "marcus.hill@gmail.com", "(407) 555-0378", "2024 Ford F-150", "needs to sell current car first"],
  ["Bethany Cole", "bethany.cole@gmail.com", "(407) 555-0389", "2024 Honda Accord", "timing question"],
  ["Trevor Ross", "trevor.ross@gmail.com", "(321) 555-0390", "2023 Ford Explorer", "financing pre-check"],
];

const TIRE_KICKER_LEADS = [
  ["Alex Rivera", "alex.rivera@gmail.com", "(407) 555-0401", "just browsing inventory"],
  ["Jordan Lee", "jordan.lee@gmail.com", "(321) 555-0412", "checking prices"],
  ["Casey Morgan", "casey.morgan@gmail.com", "(407) 555-0423", "window shopping"],
  ["Riley Adams", "riley.adams@gmail.com", "(407) 555-0434", "looking at photos"],
  ["Jamie Fox", "jamie.fox@gmail.com", "(321) 555-0445", "curious about deals"],
  ["Morgan Reed", "morgan.reed@gmail.com", "(407) 555-0456", "browsing SUVs"],
  ["Taylor Quinn", "taylor.quinn@gmail.com", "(407) 555-0467", "checking truck prices"],
  ["Devon Price", "devon.price@gmail.com", "(321) 555-0478", "just looking"],
  ["Skyler James", "skyler.james@gmail.com", "(407) 555-0489", "comparing models online"],
  ["Cameron Hayes", "cameron.hayes@gmail.com", "(407) 555-0490", "researching options"],
  ["Peyton Wells", "peyton.wells@gmail.com", "(321) 555-0501", "browsing new arrivals"],
  ["Avery Brooks", "avery.brooks@gmail.com", "(407) 555-0512", "looking around"],
];

function hotConversation(vehicle, interest) {
  return [
    { role: "assistant", content: "Hi! Welcome to Premier Auto Group. What can I help you find today?", timestamp: iso(-2 * DAY) },
    { role: "user", content: `I'm interested in the ${vehicle}. Can you tell me about ${interest}?`, timestamp: iso(-2 * DAY + 3 * MIN) },
    { role: "assistant", content: `Great choice! The ${vehicle} is one of our most popular. We can absolutely help with ${interest}. Would you like to come in for a test drive?`, timestamp: iso(-2 * DAY + 4 * MIN) },
    { role: "user", content: "Yes, I'm ready to move forward this week. What times do you have?", timestamp: iso(-1 * DAY) },
    { role: "assistant", content: "Perfect — I have openings tomorrow at 10am and 2pm. Which works better?", timestamp: iso(-1 * DAY + 2 * MIN) },
    { role: "user", content: "10am works. My budget is around $650/month.", timestamp: iso(-6 * HOUR) },
  ];
}

function warmConversation(vehicle, interest) {
  return [
    { role: "assistant", content: "Welcome to Premier Auto Group! How can I help?", timestamp: iso(-5 * DAY) },
    { role: "user", content: `Looking at the ${vehicle}. Just have a question about ${interest}.`, timestamp: iso(-5 * DAY + 2 * MIN) },
    { role: "assistant", content: `Happy to help with ${interest}. Are you looking to buy soon, or still exploring?`, timestamp: iso(-5 * DAY + 3 * MIN) },
    { role: "user", content: "Still figuring out timing, but definitely interested.", timestamp: iso(-4 * DAY) },
  ];
}

function tireKickerConversation(interest) {
  return [
    { role: "assistant", content: "Welcome to Premier Auto Group! Anything I can help you find?", timestamp: iso(-8 * DAY) },
    { role: "user", content: `Just ${interest} for now, thanks.`, timestamp: iso(-8 * DAY + 1 * MIN) },
  ];
}

// ---- per-brand seeding -----------------------------------------------------
// Seeds one demo brand's child data, gating higher-tier artifacts by `tier` and
// scaling volumes via TIER_SCALE. Returns a counts summary for the response.
async function seedBrandData(client, { adminUserId, brandId, bizName, tier }) {
  const rank = TIER_RANK[tier] || 1;
  const scale = TIER_SCALE[tier] || TIER_SCALE.starter;
  const isPro = rank >= TIER_RANK.pro;
  const isEnterprise = rank >= TIER_RANK.enterprise;

  // 1. Leads (+ CRM interactions; follow-up sequences are a Pro feature).
  const leadIds = { hot: [], warm: [], tire: [] };

  async function insertLead(name, email, phone, temperature, conversation, convStatus) {
    const res = await client.query(
      `INSERT INTO leads
         (brand_id, lead_name, email, phone, temperature, conversation_history, conversion_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING lead_id`,
      [brandId, name, email, phone, temperature, J(conversation), convStatus]
    );
    const leadId = res.rows[0].lead_id;
    await client.query(
      `INSERT INTO crm_interactions (lead_id, interaction_type, occurred_at, interaction_details)
       VALUES ($1, 'chatbot_conversation', $2, $3)`,
      [
        leadId,
        iso(-Math.floor(Math.random() * 6 + 1) * DAY),
        J({ summary: `Chatbot conversation — ${temperature} lead`, messageCount: conversation.length }),
      ]
    );
    return leadId;
  }

  for (const [name, email, phone, vehicle, interest] of HOT_LEADS.slice(0, scale.hot)) {
    const id = await insertLead(name, email, phone, "hot", hotConversation(vehicle, interest), "in_progress");
    leadIds.hot.push({ id, name, email, phone, vehicle });
    if (isPro) {
      const seq = await client.query(
        `INSERT INTO follow_up_sequences
           (brand_id, lead_id, goal, sequence_type, status, current_step, total_steps, source)
         VALUES ($1, $2, 'book_test_drive', 'nurture', 'active', 1, 3, 'auto')
         RETURNING sequence_id`,
        [brandId, id]
      );
      const seqId = seq.rows[0].sequence_id;
      await client.query(
        `INSERT INTO sequence_touchpoints (sequence_id, step_number, channel, scheduled_at, status, subject, body)
         VALUES
           ($1, 1, 'email', $2, 'sent', 'Your ${vehicle} is waiting', 'Thanks for your interest! Ready to schedule your test drive?'),
           ($1, 2, 'sms', $3, 'pending', NULL, 'Hi ${name.split(" ")[0]}, just checking in on the ${vehicle}. Want to lock in a time this week?')`,
        [seqId, iso(-1 * DAY), iso(1 * DAY)]
      );
    }
  }

  for (const [name, email, phone, vehicle, interest] of WARM_LEADS.slice(0, scale.warm)) {
    const id = await insertLead(name, email, phone, "warm", warmConversation(vehicle, interest), "new");
    leadIds.warm.push({ id, name, email, phone, vehicle });
    if (isPro) {
      const seq = await client.query(
        `INSERT INTO follow_up_sequences
           (brand_id, lead_id, goal, sequence_type, status, current_step, total_steps, source)
         VALUES ($1, $2, 'reengage', 'nurture', 'active', 1, 4, 'auto')
         RETURNING sequence_id`,
        [brandId, id]
      );
      await client.query(
        `INSERT INTO sequence_touchpoints (sequence_id, step_number, channel, scheduled_at, status, subject, body)
         VALUES ($1, 1, 'email', $2, 'sent', 'Still thinking it over?', 'No rush — here are a few options in your range whenever you are ready.')`,
        [seq.rows[0].sequence_id, iso(-2 * DAY)]
      );
    }
  }

  for (const [name, email, phone, interest] of TIRE_KICKER_LEADS.slice(0, scale.tire)) {
    const id = await insertLead(name, email, phone, "tire_kicker", tireKickerConversation(interest), "new");
    leadIds.tire.push({ id, name, email, phone });
  }

  // 2. Facebook campaigns + weekly analytics (all tiers).
  const allCampaigns = [
    ["New Arrivals This Week", 600, 11.23, 0.14, 42, "New inventory spotlights for Orlando car buyers aged 25-55."],
    ["Zero Down Financing Available", 400, 14.28, 0.11, 28, "First-time buyer financing offers."],
    ["Truck Season", 500, 16.13, 0.13, 31, "Truck buyer targeting — F-150, Silverado, RAM."],
    ["Certified Pre-Owned Deals", 350, 12.5, 0.1, 19, "Pre-owned inventory under $30k."],
  ];
  const campaigns = allCampaigns.slice(0, scale.campaigns);
  for (const [cname, budget, cpl, convRate, leads, concept] of campaigns) {
    await client.query(
      `INSERT INTO campaigns
         (brand_id, user_id, campaign_name, budget, cost_per_lead, conversion_rate, ad_creative_variations, launch_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        brandId, adminUserId, cname, budget, cpl, convRate,
        J([{ headline: cname, primaryText: concept, leadsGenerated: leads }]),
        new Date(Date.now() - 21 * DAY).toISOString().slice(0, 10),
      ]
    );
  }
  for (let w = 0; w < 4; w++) {
    const weekDate = new Date(Date.now() - w * 7 * DAY).toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO analytics (brand_id, week_date, total_spend, total_leads, cost_per_lead, conversions, return_on_ad_spend)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (brand_id, week_date) DO NOTHING`,
      [brandId, weekDate, 1850 - w * 120, 120 - w * 8, 13.2 + w * 0.4, 4 - (w % 2), 6.8 - w * 0.3]
    );
  }

  // 3. Social posts (all tiers). Content calendar is a Pro feature. Starter is
  // limited to two platforms (matches the live "no 3rd platform below Pro" rule).
  if (isPro) {
    const now = new Date();
    await client.query(
      `INSERT INTO content_calendars (brand_id, month, year, posting_frequency, content_theme, status)
       VALUES ($1, $2, $3, '3x per week', $4, 'active')`,
      [brandId, now.getMonth() + 1, now.getFullYear(), "New inventory, customer deliveries, financing tips, and weekend sales events."]
    );
  }
  const allPostThemes = [
    ["facebook", "🚗 Just landed: 2024 F-150 lineup now on the lot! Come see them this weekend."],
    ["instagram", "Another happy customer driving off in their dream car! 🎉 #PremierAutoGroup"],
    ["youtube", "Financing 101: How zero-down works and who qualifies. Watch now."],
    ["facebook", "Weekend Sales Event 🔥 Special pricing on all certified pre-owned SUVs."],
    ["instagram", "Truck season is here 🛻 Swipe to see this week's arrivals."],
    ["facebook", "Meet the team that makes car buying easy. We're here for you."],
    ["instagram", "Customer delivery day! Congrats to the Alvarez family on their new RAV4 🥳"],
    ["youtube", "2024 Silverado walkaround — everything you need to know."],
    ["facebook", "Trade in your old car for top dollar. Get an instant quote today."],
    ["instagram", "Behind the scenes at Premier Auto Group ✨"],
    ["facebook", "Low APR financing available for qualified buyers. Ask us how."],
    ["youtube", "How to pick between leasing and buying — a quick guide."],
    ["instagram", "New week, new inventory 🚙 Which one is calling your name?"],
    ["facebook", "Family car buying made simple. Bring the kids — we've got snacks!"],
    ["instagram", "5-star service, every time. Thank you for trusting us! ⭐⭐⭐⭐⭐"],
  ];
  const themePool = isPro ? allPostThemes : allPostThemes.filter(([p]) => p !== "youtube");
  const postThemes = themePool.slice(0, scale.posts);
  const futureFrom = Math.ceil(postThemes.length / 2);
  for (let i = 0; i < postThemes.length; i++) {
    const [platform, content] = postThemes[i];
    const future = i >= futureFrom;
    await client.query(
      `INSERT INTO social_posts (brand_id, platform, post_content, scheduled_time, published_time, status, engagement_metrics)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        brandId, platform, content,
        future ? iso((i - futureFrom + 1) * DAY) : iso(-(futureFrom - i) * DAY),
        future ? null : iso(-(futureFrom - i) * DAY),
        future ? "scheduled" : "published",
        future ? null : J({ likes: 40 + i * 7, comments: 3 + (i % 5), shares: 1 + (i % 4) }),
      ]
    );
  }

  // 4. Ad creative packages (Forge) — Pro feature.
  if (isPro) {
    await client.query(
      `INSERT INTO ad_creatives (brand_id, campaign_goal, creative_concept, status)
       VALUES ($1, $2, $3, 'draft')`,
      [
        brandId,
        "Drive test-drive appointments for new and pre-owned inventory",
        J({
          budgetRange: "$350-$600/mo",
          productFocus: "New & certified pre-owned vehicles",
          packages: [
            { angle: "Emotional", headline: "The car your family deserves", primaryText: "Picture weekend road trips in a vehicle built for memories.", cta: "Book a test drive" },
            { angle: "Logical", headline: "Zero down. Low monthly. Real numbers.", primaryText: "See exactly what you'll pay before you step in the door.", cta: "Get your quote" },
            { angle: "Social proof", headline: "4.8 stars from 500+ Orlando drivers", primaryText: "Join the families who found their perfect car with us.", cta: "See reviews" },
            { angle: "Urgency", headline: "This week's arrivals won't last", primaryText: "Limited inventory on 2024 trucks and SUVs. Move fast.", cta: "View inventory" },
            { angle: "Curiosity", headline: "The financing trick dealers don't advertise", primaryText: "How qualified buyers are getting into new trucks for less.", cta: "Learn how" },
          ],
        }),
      ]
    );
  }

  // 5. Competitor intelligence (Scout) — Enterprise feature.
  if (isEnterprise) {
    await client.query(
      `INSERT INTO competitor_intelligence (brand_id, competitor_names, intelligence_report)
       VALUES ($1, $2, $3)`,
      [
        brandId,
        J(["Sunshine Motors Orlando", "Central Florida Auto Mart"]),
        J({
          summary: "Two aggressive local competitors are leaning on price and financing ads but neglecting service and response speed.",
          competitors: [
            { name: "Sunshine Motors Orlando", strategy: "Heavy zero-down financing ads, low price anchoring", weakness: "Slow lead response (48h+), poor review sentiment on after-sale service" },
            { name: "Central Florida Auto Mart", strategy: "Aggressive pre-owned pricing, high ad volume", weakness: "No chatbot, thin social proof, generic creative" },
          ],
          gaps: ["Faster response times (Premier replies in minutes)", "Superior customer-service messaging", "Authentic customer delivery content"],
          recommendedCounterStrategy: "Lead every ad with 'answered in minutes' and real 5-star service stories; retarget competitor shoppers with trade-in offers.",
        }),
      ]
    );
  }

  // 6. ROI snapshot (all tiers).
  await client.query(
    `INSERT INTO roi_snapshots
       (brand_id, week_date, total_leads, hot_leads, estimated_lead_value, ad_spend_managed, cost_per_lead, hours_saved, money_saved, total_roi_estimate)
     VALUES ($1, $2, 120, 15, 127000, 1850, 15.42, 32, 4200, 127000)
     ON CONFLICT (brand_id, week_date) DO NOTHING`,
    [brandId, new Date().toISOString().slice(0, 10)]
  );

  // 7. Customer intelligence brief (Echo) — Enterprise feature.
  if (isEnterprise) {
    await client.query(
      `INSERT INTO customer_intelligence
         (brand_id, week_date, raw_profile_data, recommendations, trends_identified, trajectory_score, ai_analysis)
       VALUES ($1, $2, $3, $4, $5, 9, $6)
       ON CONFLICT (brand_id, week_date) DO NOTHING`,
      [
        brandId,
        new Date().toISOString().slice(0, 10),
        J({ topSegment: "Truck buyers 30-50", pipelineValue: 127000, avgDealSize: 31750, closedDeals: 4 }),
        J([
          "Target truck buyers more aggressively before end of quarter — highest close rate and deal size.",
          "Shift 15% of budget from pre-owned to New Arrivals; lowest cost-per-lead this month.",
          "Add a weekend-only zero-down retargeting push for warm leads waiting on financing.",
        ]),
        J([
          "Lead quality up 23% over the last 12 weeks.",
          "Truck inquiries growing 18% month-over-month.",
          "Response time now under 4 minutes — well ahead of local competitors.",
        ]),
        "Premier Auto Group is on a strong upward trajectory. Truck demand and improving lead quality point to an excellent close to the quarter if truck targeting is prioritized.",
      ]
    );
  }

  // 8. Sales scripts — Pro feature.
  if (isPro) {
    const scripts = [
      ["first_time_buyer", "First-time car buyers, nervous about financing"],
      ["trade_in", "Customers trading in an existing vehicle"],
      ["luxury_buyer", "High-income buyers seeking premium trims"],
      ["fleet_buyer", "Small business owners buying multiple vehicles"],
      ["financing_challenged", "Buyers with credit challenges needing options"],
      ["repeat_customer", "Returning customers upgrading their vehicle"],
    ];
    for (const [saleType, persona] of scripts) {
      await client.query(
        `INSERT INTO sales_scripts (brand_id, sale_type, target_persona, script_content, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [
          brandId, saleType, persona,
          J({
            opening: `Welcome to ${bizName}! I'm so glad you're here. Tell me a little about what brought you in today.`,
            discovery: ["What are you driving now?", "What's most important — payment, features, or timing?", "Is this for you or the whole family?"],
            valueProps: ["No-pressure buying", "Answered in minutes", "Transparent, upfront pricing", "4.8-star service"],
            objectionHandling: { price: "Let's find the number that works for you — we have options.", timing: "No rush. Let me hold this one and send you the exact figures." },
            close: "Based on everything you told me, this is the perfect fit. Want to take it for a spin?",
          }),
        ]
      );
    }
  }

  // 9. Reviews (4.8★) with Echo-generated responses — Pro feature (Reputation).
  if (isPro) {
    const reviews = [
      ["Jennifer H.", 5, "Fastest response I've ever had from a dealership. Answered my questions in minutes!", "Thank you so much, Jennifer! Fast, honest service is what we're all about. Enjoy the new ride! 🚗"],
      ["Robert M.", 5, "The staff were incredibly helpful and never pushy. Got a great deal on my F-150.", "We appreciate you, Robert! Congrats on the F-150 — come back anytime. 🛻"],
      ["Denise T.", 4, "Smooth process overall. Financing took a little while but the team kept me updated.", "Thanks for the feedback, Denise! We're always working to speed things up. So glad you're happy with your car."],
      ["Carlos V.", 5, "Best car buying experience. The whole team made it easy and stress-free.", "That means the world to us, Carlos! Thank you for trusting Premier Auto Group. 🙌"],
    ];
    for (const [reviewer, stars, text, response] of reviews) {
      await client.query(
        `INSERT INTO reviews (brand_id, platform, external_id, reviewer_name, star_rating, review_text, response_text, response_status, posted_at)
         VALUES ($1, 'google', $2, $3, $4, $5, $6, 'responded', $7)`,
        [brandId, `demo-${reviewer.replace(/\W/g, "")}`, reviewer, stars, text, response, iso(-Math.floor(Math.random() * 20 + 2) * DAY)]
      );
    }
  }

  // 10. Customer feedback survey + responses — Enterprise feature.
  if (isEnterprise) {
    const surveyRes = await client.query(
      `INSERT INTO surveys (brand_id, survey_type, questions)
       VALUES ($1, 'general', $2)
       RETURNING survey_id`,
      [
        brandId,
        J([
          { id: "q1", text: "How satisfied were you with your experience?", type: "scale" },
          { id: "q2", text: "How would you rate our follow-up?", type: "scale" },
          { id: "q3", text: "Any comments?", type: "text" },
        ]),
      ]
    );
    const surveyId = surveyRes.rows[0].survey_id;
    const feedbackComments = [
      "Professional and quick to respond.",
      "Loved how they followed up without being pushy.",
      "Great experience, will buy here again.",
      "The team really knows their stuff.",
      "Follow-up was excellent.",
    ];
    const respondents = [...leadIds.hot.slice(0, 3), ...leadIds.warm.slice(0, 4)];
    for (let i = 0; i < respondents.length; i++) {
      const r = respondents[i];
      await client.query(
        `INSERT INTO survey_responses (survey_id, brand_id, lead_id, respondent_email, answers, sentiment_score, responded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          surveyId, brandId, r.id, r.email,
          J({ q1: 9 + (i % 2 === 0 ? 1 : 0) > 10 ? 10 : 9, q2: 9, q3: feedbackComments[i % feedbackComments.length] }),
          9 + (i % 2),
          iso(-Math.floor(Math.random() * 15 + 1) * DAY),
        ]
      );
    }
  }

  // 11. Appointments — Pro feature (18 past + 3 upcoming this week).
  if (isPro) {
    const upcoming = [
      ["David Alvarez", "2024 Ford F-150 test drive", 10, leadIds.hot[2]],
      ["Maria Santos", "Pre-owned SUV test drive", 14, null],
      ["James Whitfield", "Trade-in evaluation", 16, null],
    ];
    for (const [contact, title, hour, lead] of upcoming) {
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start.getTime() + HOUR);
      await client.query(
        `INSERT INTO appointments (brand_id, lead_id, title, description, location, start_time, end_time, status, contact_name, contact_email, contact_phone, source)
         VALUES ($1, $2, $3, $4, 'Premier Auto Group Showroom', $5, $6, 'scheduled', $7, $8, $9, 'chatbot')`,
        [
          brandId, lead ? lead.id : null, title, `${title} with ${contact}`,
          start.toISOString(), end.toISOString(), contact,
          lead ? lead.email : `${contact.split(" ")[0].toLowerCase()}@example.com`,
          lead ? lead.phone : "(407) 555-0100",
        ]
      );
    }
    for (let i = 0; i < 18; i++) {
      const start = new Date(Date.now() - (i + 1) * 2 * DAY);
      start.setHours(9 + (i % 8), 0, 0, 0);
      const end = new Date(start.getTime() + HOUR);
      const status = i % 6 === 0 ? "no_show" : "completed";
      await client.query(
        `INSERT INTO appointments (brand_id, title, description, location, start_time, end_time, status, contact_name, contact_email, source)
         VALUES ($1, 'Test drive', 'Completed showroom appointment', 'Premier Auto Group Showroom', $2, $3, $4, $5, $6, 'manual')`,
        [brandId, start.toISOString(), end.toISOString(), status, `Guest ${i + 1}`, `guest${i + 1}@example.com`]
      );
    }
  }

  return {
    leads: scale.hot + scale.warm + scale.tire,
    hotLeads: scale.hot,
    warmLeads: scale.warm,
    tireKickers: scale.tire,
    campaigns: campaigns.length,
    posts: postThemes.length,
    reviews: isPro ? 4 : 0,
    salesScripts: isPro ? 6 : 0,
    appointments: isPro ? 21 : 0,
  };
}

// ---- main seeder -----------------------------------------------------------
async function seedDemo({ businessName } = {}) {
  const client = await db.getClient();
  try {
    const adminRes = await client.query(
      "SELECT user_id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1"
    );
    if (adminRes.rows.length === 0) {
      throw new Error("No admin user found to own the demo account.");
    }
    const adminUserId = adminRes.rows[0].user_id;

    const cfgRes = await client.query(
      "SELECT business_name, prospect_name FROM demo_config WHERE id = true"
    );
    const cfg = cfgRes.rows[0] || {};
    const bizName = (businessName || cfg.business_name || DEMO_BUSINESS_DEFAULT).trim();
    const prospectName = cfg.prospect_name || null;

    await client.query("BEGIN");

    // 1. Wipe ALL existing demo brands for this admin (cascade clears children).
    await client.query(
      "DELETE FROM brands WHERE user_id = $1 AND is_demo = true",
      [adminUserId]
    );

    // 2. Create one demo brand per tier, each with tier-appropriate data.
    const brands = [];
    for (const tier of TIER_ORDER) {
      const brandRes = await client.query(
        `INSERT INTO brands
           (user_id, brand_name, brand_personality, voice_description,
            visual_style_preferences, target_audience, is_demo, demo_tier)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         RETURNING brand_id`,
        [
          adminUserId,
          bizName,
          "Trustworthy, high-energy, community-focused auto dealership that makes car buying easy and pressure-free.",
          "Warm, confident, and helpful — like a friend who happens to know everything about cars.",
          J({ primaryColor: "#0B5FA5", accentColor: "#E63946", tone: "energetic-professional" }),
          J({ location: "Orlando, FL", ageRange: "25-55", interests: ["new vehicles", "pre-owned vehicles", "financing", "trucks", "SUVs"] }),
          tier,
        ]
      );
      const brandId = brandRes.rows[0].brand_id;
      const counts = await seedBrandData(client, { adminUserId, brandId, bizName, tier });
      brands.push({ brandId, tier, counts });
    }

    // 3. Save config + morning briefing. No tier is active yet: the presenter
    // chooses which plan to demo on the selection screen after seeding.
    const briefing = buildMorningBriefing(bizName, prospectName);
    await client.query(
      `UPDATE demo_config
         SET business_name = $1, demo_brand_id = NULL, active_tier = NULL,
             morning_briefing = $2, seeded_at = NOW(), updated_at = NOW()
       WHERE id = true`,
      [bizName, briefing]
    );

    await client.query("COMMIT");

    return {
      businessName: bizName,
      brands: brands.map((b) => ({ brandId: b.brandId, tier: b.tier })),
      counts: brands.reduce((acc, b) => {
        acc[b.tier] = b.counts;
        return acc;
      }, {}),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { seedDemo, buildMorningBriefing, DEMO_BUSINESS_DEFAULT };

const db = require("../config/db");
const { decrypt } = require("../utils/encryption");
const { generateReviewResponse } = require("../prompts/reputationPrompt");
const zapierController = require("./zapierController");
const {
  getValidAccessToken,
  googleFetch,
  oauthConfigured,
} = require("./googleController");

const VALID_PLATFORMS = ["google", "facebook", "yelp"];
const GRAPH = "https://graph.facebook.com/v19.0";

/** Loads a brand (with voice fields) only if it belongs to the authed user. */
async function getOwnedBrand(userId, brandId) {
  const result = await db.query(
    `SELECT brand_id, brand_name, brand_personality, voice_description,
            target_audience
     FROM brands
     WHERE brand_id = $1 AND user_id = $2`,
    [brandId, userId],
  );
  return result.rows[0] || null;
}

/** Maps Google's enum star rating to a 1-5 integer. */
function googleStarToInt(star) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[star] || Number(star) || 0;
}

/**
 * Pulls recent Google Business Profile reviews for the connected Google account.
 * Returns [] (with a note) when the user hasn't connected Google or the Business
 * Profile API is unavailable — never throws past the caller's per-platform catch.
 */
async function fetchGoogleReviews(userId) {
  if (!oauthConfigured()) {
    return { reviews: [], error: "Google connection is not configured." };
  }
  const { accessToken } = await getValidAccessToken(userId);

  const accounts = await googleFetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    accessToken,
    "Business Profile accounts",
  );
  const account = (accounts.accounts || [])[0];
  if (!account) return { reviews: [] };

  const locResp = await googleFetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
    accessToken,
    "Business Profile locations",
  );
  const location = (locResp.locations || [])[0];
  if (!location) return { reviews: [] };

  const reviewResp = await googleFetch(
    `https://mybusiness.googleapis.com/v4/${account.name}/${location.name}/reviews`,
    accessToken,
    "Business Profile reviews",
  );

  const reviews = (reviewResp.reviews || []).map((r) => {
    // Prefer the full resource path (accounts/.../locations/.../reviews/<id>) so
    // postGoogleReply can target /v4/.../reply. The v4 list returns `name` as the
    // full path; fall back to constructing it from the account/location + reviewId.
    let resourcePath = r.name || null;
    if (!resourcePath && r.reviewId) {
      resourcePath = `${account.name}/${location.name}/reviews/${r.reviewId}`;
    }
    return {
      platform: "google",
      externalId: resourcePath,
      reviewerName: r.reviewer?.displayName || "Google user",
      starRating: googleStarToInt(r.starRating),
      reviewText: r.comment || "",
      postedAt: r.createTime || null,
      alreadyResponded: Boolean(r.reviewReply?.comment),
    };
  });
  return { reviews };
}

/**
 * Pulls recent Facebook Page ratings/recommendations using the stored long-lived
 * user token. Reviews live on a Page, so we list the user's pages and read the
 * first page's ratings.
 */
async function fetchFacebookReviews(userId) {
  const result = await db.query(
    `SELECT api_token_encrypted, connection_status
     FROM api_integrations
     WHERE user_id = $1 AND platform = 'facebook'`,
    [userId],
  );
  const row = result.rows[0];
  if (!row || !row.api_token_encrypted) {
    return { reviews: [], error: "Facebook account is not connected." };
  }
  const userToken = decrypt(row.api_token_encrypted);

  // Find the first managed Page and its page-scoped access token.
  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,
  );
  const pagesData = await pagesRes.json().catch(() => ({}));
  if (!pagesRes.ok || pagesData.error) {
    const err = new Error(
      pagesData.error?.message || `Facebook pages lookup failed (HTTP ${pagesRes.status})`,
    );
    err.facebookError = true;
    throw err;
  }
  const page = (pagesData.data || [])[0];
  if (!page) return { reviews: [] };

  const ratingsRes = await fetch(
    `${GRAPH}/${page.id}/ratings?fields=reviewer{name},rating,review_text,created_time,recommendation_type` +
      `&access_token=${encodeURIComponent(page.access_token)}`,
  );
  const ratingsData = await ratingsRes.json().catch(() => ({}));
  if (!ratingsRes.ok || ratingsData.error) {
    const err = new Error(
      ratingsData.error?.message || `Facebook ratings fetch failed (HTTP ${ratingsRes.status})`,
    );
    err.facebookError = true;
    throw err;
  }

  const reviews = (ratingsData.data || []).map((r) => {
    // Facebook recommendations have no star rating; map positive/negative to 5/1.
    let stars = Number(r.rating) || 0;
    if (!stars && r.recommendation_type) {
      stars = r.recommendation_type === "positive" ? 5 : 1;
    }
    return {
      platform: "facebook",
      externalId: r.open_graph_story?.id || r.created_time || null,
      reviewerName: r.reviewer?.name || "Facebook user",
      starRating: stars || 0,
      reviewText: r.review_text || "",
      postedAt: r.created_time || null,
      alreadyResponded: false,
    };
  });
  return { reviews };
}

/** Persists fetched reviews (upsert by platform external_id), returns inserted count. */
async function persistFetchedReviews(brandId, reviews) {
  let saved = 0;
  for (const rv of reviews) {
    if (!rv.externalId || !rv.starRating) continue; // skip un-keyable / rating-less
    const status = rv.alreadyResponded ? "responded" : "pending";
    const res = await db.query(
      `INSERT INTO reviews
         (brand_id, platform, external_id, reviewer_name, star_rating,
          review_text, response_status, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (brand_id, platform, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET reviewer_name = EXCLUDED.reviewer_name,
                     star_rating = EXCLUDED.star_rating,
                     review_text = EXCLUDED.review_text,
                     posted_at = EXCLUDED.posted_at
       RETURNING (xmax = 0) AS inserted`,
      [
        brandId,
        rv.platform,
        rv.externalId,
        rv.reviewerName,
        rv.starRating,
        rv.reviewText,
        status,
        rv.postedAt ? new Date(rv.postedAt) : null,
      ],
    );
    if (res.rows[0]?.inserted) {
      saved++;
      // Outbound webhook (Zapier etc.) for each newly received review.
      zapierController.triggerWebhook(brandId, "new_review_received", {
        platform: rv.platform,
        reviewerName: rv.reviewerName,
        starRating: rv.starRating,
        reviewText: rv.reviewText,
        source: "fetched",
      });
    }
  }
  return saved;
}

/**
 * POST /api/reputation/:brandId/fetch
 * Pulls recent reviews from Google + Facebook, stores them, and reports per-
 * platform results. Yelp has no public API, so it is manual-entry only.
 */
async function fetchReviews(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const platforms = {};

    // Google
    try {
      const { reviews, error } = await fetchGoogleReviews(userId);
      const saved = await persistFetchedReviews(brandId, reviews);
      platforms.google = { fetched: reviews.length, saved, error: error || null };
    } catch (err) {
      platforms.google = { fetched: 0, saved: 0, error: err.message };
    }

    // Facebook
    try {
      const { reviews, error } = await fetchFacebookReviews(userId);
      const saved = await persistFetchedReviews(brandId, reviews);
      platforms.facebook = { fetched: reviews.length, saved, error: error || null };
    } catch (err) {
      platforms.facebook = { fetched: 0, saved: 0, error: err.message };
    }

    // Yelp — no public review API.
    platforms.yelp = {
      fetched: 0,
      saved: 0,
      manualOnly: true,
      error: "Yelp has no public reviews API — add Yelp reviews manually.",
    };

    return res.json({ brandId, platforms });
  } catch (err) {
    console.error("Fetch reviews error:", err.message);
    return res.status(500).json({ error: "Failed to fetch reviews" });
  }
}

/**
 * POST /api/reputation/:brandId/reviews
 * Manually add a review (used for Yelp, which has no API). Validates the platform
 * and star rating, stores it, returns the saved row.
 */
async function addReview(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  const { platform, reviewerName, starRating, reviewText, postedAt } = req.body;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    if (!VALID_PLATFORMS.includes(platform)) {
      return res
        .status(400)
        .json({ error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` });
    }
    const stars = Number(starRating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "starRating must be an integer 1-5" });
    }
    if (!reviewText || !String(reviewText).trim()) {
      return res.status(400).json({ error: "reviewText is required" });
    }

    const { rows } = await db.query(
      `INSERT INTO reviews
         (brand_id, platform, reviewer_name, star_rating, review_text, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        brandId,
        platform,
        reviewerName?.trim() || "Anonymous",
        stars,
        String(reviewText).trim(),
        postedAt ? new Date(postedAt) : new Date(),
      ],
    );
    const review = rows[0];
    // Outbound webhook (Zapier etc.) for the manually added review.
    zapierController.triggerWebhook(brandId, "new_review_received", {
      reviewId: review.review_id,
      platform: review.platform,
      reviewerName: review.reviewer_name,
      starRating: review.star_rating,
      reviewText: review.review_text,
      source: "manual",
    });
    return res.status(201).json({ review });
  } catch (err) {
    console.error("Add review error:", err.message);
    return res.status(500).json({ error: "Failed to add review" });
  }
}

/** Loads a review by id only if its brand belongs to the authed user. */
async function getOwnedReview(userId, reviewId) {
  const result = await db.query(
    `SELECT r.*, b.brand_name, b.brand_personality, b.voice_description
     FROM reviews r
     JOIN brands b ON r.brand_id = b.brand_id
     WHERE r.review_id = $1 AND b.user_id = $2`,
    [reviewId, userId],
  );
  return result.rows[0] || null;
}

/**
 * POST /api/reputation/reviews/:reviewId/generate
 * Generates an AI response for a review in the brand's voice. Returns the draft
 * (not posted) so the owner can edit before posting. Upstream AI errors -> 502.
 */
async function generateResponse(req, res) {
  const userId = req.user.userId;
  const { reviewId } = req.params;
  const { contactInfo } = req.body || {};
  try {
    const review = await getOwnedReview(userId, reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    const brand = {
      brand_name: review.brand_name,
      brand_personality: review.brand_personality,
      voice_description: review.voice_description,
    };
    const response = await generateReviewResponse(brand, {
      reviewerName: review.reviewer_name,
      starRating: review.star_rating,
      reviewText: review.review_text,
      platform: review.platform,
      contactInfo: contactInfo || null,
    });

    return res.json({ reviewId, response });
  } catch (err) {
    console.error("Generate review response error:", err.message);
    if (typeof err.status === "number" && err.status >= 400) {
      return res.status(502).json({
        error:
          "The AI provider could not generate a response right now. Please try again shortly.",
      });
    }
    return res.status(500).json({ error: "Failed to generate response" });
  }
}

/** Posts a reply to a Google Business Profile review via the v4 API. */
async function postGoogleReply(userId, review, responseText) {
  const { accessToken } = await getValidAccessToken(userId);
  // external_id holds the full review resource name (accounts/.../reviews/...).
  const reviewPath = review.external_id;
  if (!reviewPath || !reviewPath.includes("/reviews/")) {
    const err = new Error(
      "This Google review can't be replied to automatically (missing review reference). Re-fetch reviews and try again.",
    );
    err.unpostable = true;
    throw err;
  }
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${reviewPath}/reply`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ comment: responseText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Google reply failed (HTTP ${res.status})`);
    err.platformError = true;
    throw err;
  }
}

/**
 * POST /api/reputation/reviews/:reviewId/respond
 * Saves the (edited) response and posts it back to the platform when supported.
 * Google replies are posted via API. Facebook and Yelp don't support posting
 * review replies via API, so the response is saved and flagged for manual posting
 * (explicit message — no silent pretend-success).
 */
async function postResponse(req, res) {
  const userId = req.user.userId;
  const { reviewId } = req.params;
  const { response } = req.body || {};
  try {
    if (!response || !String(response).trim()) {
      return res.status(400).json({ error: "response text is required" });
    }
    const review = await getOwnedReview(userId, reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    const responseText = String(response).trim();
    let postedToPlatform = false;
    let note = null;

    if (review.platform === "google") {
      try {
        await postGoogleReply(userId, review, responseText);
        postedToPlatform = true;
      } catch (err) {
        if (err.platformError || err.googleError) {
          return res.status(502).json({ error: `Google API error: ${err.message}` });
        }
        if (err.notConnected) {
          return res.status(400).json({ error: "Connect your Google account first." });
        }
        if (err.unpostable) {
          note = err.message;
        } else {
          throw err;
        }
      }
    } else {
      // Facebook & Yelp: no API to post a review reply — save it for manual posting.
      note =
        review.platform === "facebook"
          ? "Facebook doesn't allow posting review replies via API — copy this response and post it from your Page."
          : "Yelp has no API to post responses — copy this response and post it on Yelp.";
    }

    const { rows } = await db.query(
      `UPDATE reviews
       SET response_text = $1, response_status = 'responded'
       WHERE review_id = $2
       RETURNING *`,
      [responseText, reviewId],
    );

    return res.json({ review: rows[0], postedToPlatform, note });
  } catch (err) {
    console.error("Post review response error:", err.message);
    return res.status(500).json({ error: "Failed to post response" });
  }
}

/**
 * POST /api/reputation/reviews/:reviewId/ignore
 * Marks a review as ignored (no response needed).
 */
async function ignoreReview(req, res) {
  const userId = req.user.userId;
  const { reviewId } = req.params;
  try {
    const review = await getOwnedReview(userId, reviewId);
    if (!review) return res.status(404).json({ error: "Review not found" });

    const { rows } = await db.query(
      `UPDATE reviews SET response_status = 'ignored'
       WHERE review_id = $1 RETURNING *`,
      [reviewId],
    );
    return res.json({ review: rows[0] });
  } catch (err) {
    console.error("Ignore review error:", err.message);
    return res.status(500).json({ error: "Failed to ignore review" });
  }
}

/**
 * GET /api/reputation/:brandId
 * Returns all reviews for a brand (newest first) plus reputation stats:
 * average rating per platform, totals, response rate, and a 30-day rating trend.
 */
async function getReviews(req, res) {
  const userId = req.user.userId;
  const { brandId } = req.params;
  try {
    const brand = await getOwnedBrand(userId, brandId);
    if (!brand) return res.status(404).json({ error: "Brand not found" });

    const { rows: reviews } = await db.query(
      `SELECT review_id, brand_id, platform, reviewer_name, star_rating,
              review_text, response_text, response_status, posted_at,
              created_at, updated_at
       FROM reviews
       WHERE brand_id = $1
       ORDER BY COALESCE(posted_at, created_at) DESC`,
      [brandId],
    );

    // Per-platform aggregates.
    const { rows: byPlatform } = await db.query(
      `SELECT platform,
              COUNT(*)::int AS total,
              ROUND(AVG(star_rating)::numeric, 2) AS avg_rating
       FROM reviews WHERE brand_id = $1
       GROUP BY platform`,
      [brandId],
    );

    const total = reviews.length;
    const responded = reviews.filter((r) => r.response_status === "responded").length;
    const pending = reviews.filter((r) => r.response_status === "pending").length;
    const ignored = reviews.filter((r) => r.response_status === "ignored").length;
    const overallAvg =
      total > 0
        ? Math.round((reviews.reduce((s, r) => s + r.star_rating, 0) / total) * 100) / 100
        : null;

    // 30-day daily rating trend.
    const { rows: trend } = await db.query(
      `SELECT (COALESCE(posted_at, created_at))::date AS day,
              ROUND(AVG(star_rating)::numeric, 2) AS avg_rating,
              COUNT(*)::int AS count
       FROM reviews
       WHERE brand_id = $1
         AND COALESCE(posted_at, created_at) >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1 ASC`,
      [brandId],
    );

    return res.json({
      brandId,
      reviews,
      stats: {
        total,
        responded,
        pending,
        ignored,
        overallAvgRating: overallAvg,
        responseRate: total > 0 ? Math.round((responded / total) * 100) : 0,
        byPlatform: byPlatform.map((p) => ({
          platform: p.platform,
          total: p.total,
          avgRating: p.avg_rating != null ? Number(p.avg_rating) : null,
        })),
        trend: trend.map((t) => ({
          day: t.day,
          avgRating: Number(t.avg_rating),
          count: t.count,
        })),
      },
    });
  } catch (err) {
    console.error("Get reviews error:", err.message);
    return res.status(500).json({ error: "Failed to load reviews" });
  }
}

module.exports = {
  fetchReviews,
  addReview,
  generateResponse,
  postResponse,
  ignoreReview,
  getReviews,
};

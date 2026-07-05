const crypto = require("crypto");

const db = require("../config/db");
const { sendEmail } = require("../utils/email");
const {
  teamInvitationEmail,
  teamMemberAddedEmail,
} = require("../utils/emailTemplates");
const { syncSeatItem } = require("./subscriptionController");
const {
  seatLimitFor,
  additionalSeats,
  computeMonthlyTotal,
  ADDITIONAL_SEAT_PRICE,
} = require("../config/plans");

const { normalizeE164 } = require("../utils/phone");

// New invites/role changes use these three. `viewer` is retired from the UI but
// still accepted at the DB level (legacy members) and treated as read-only.
const VALID_ROLES = ["admin", "manager", "sales_rep"];
const ROLE_LABEL = "admin, manager, or sales_rep";
const INVITE_TTL_HOURS = 48;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function appBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.REPLIT_DOMAINS) {
    return `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`;
  }
  return `${req.protocol}://${req.get("host")}`;
}

/**
 * Recomputes the owner's billed seat count (1 owner + active members), persists
 * it to users.team_size, and syncs the Stripe per-seat line item. Best-effort
 * on the Stripe side; returns the seat/billing summary.
 */
async function recomputeOwnerSeats(ownerId) {
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS active
       FROM team_members
      WHERE account_owner_user_id = $1 AND status = 'active'`,
    [ownerId]
  );
  const activeMembers = countRes.rows[0] ? countRes.rows[0].active : 0;
  const teamSize = 1 + activeMembers;

  await db.query("UPDATE users SET team_size = $1 WHERE user_id = $2", [
    teamSize,
    ownerId,
  ]);

  const subRes = await db.query(
    `SELECT s.subscription_tier, s.stripe_subscription_id
       FROM subscriptions s
      WHERE s.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [ownerId]
  );

  const tier = subRes.rows[0] ? subRes.rows[0].subscription_tier : null;
  const stripeSubscriptionId = subRes.rows[0]
    ? subRes.rows[0].stripe_subscription_id
    : null;

  if (tier && stripeSubscriptionId) {
    try {
      await syncSeatItem(stripeSubscriptionId, tier, teamSize);
    } catch (err) {
      console.error("Seat sync (team change) failed:", err.message);
    }
  }

  return {
    teamSize,
    activeMembers,
    tier,
    includedSeats: tier ? seatLimitFor(tier) : null,
    additionalSeats: tier ? additionalSeats(tier, teamSize) : 0,
    additionalSeatPrice: ADDITIONAL_SEAT_PRICE,
    monthlyTotal: tier ? computeMonthlyTotal(tier, teamSize) : null,
  };
}

async function getOwnerContext(ownerId) {
  const res = await db.query(
    `SELECT u.email, u.business_name, s.subscription_tier
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.user_id
      WHERE u.user_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1`,
    [ownerId]
  );
  return res.rows[0] || null;
}

/**
 * POST /api/team/invite  (auth, lockout, admin+)
 * Invites a person by email + role. If they already have an EchoAI account they
 * are linked immediately (active); otherwise a pending record + 48h token email.
 */
async function inviteMember(req, res) {
  const ownerId = req.user.userId;
  const email = normalizeEmail(req.body.email);
  const role = String(req.body.role || "").trim();
  const rawPhone = req.body.phone;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${ROLE_LABEL}.` });
  }

  // Sales reps call leads through the phone bridge, which rings THEIR phone
  // first — so a valid number is required at invite time. Other roles may
  // optionally store one.
  let phone = null;
  if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim()) {
    phone = normalizeE164(rawPhone);
    if (!phone) {
      return res.status(400).json({
        error: "Enter a valid phone number in E.164 format, e.g. +15551234567.",
      });
    }
  }
  if (role === "sales_rep" && !phone) {
    return res.status(400).json({
      error:
        "A sales rep needs a phone number — the platform calls their phone first, then connects the lead.",
    });
  }

  try {
    const owner = await getOwnerContext(ownerId);
    if (owner && normalizeEmail(owner.email) === email) {
      return res
        .status(400)
        .json({ error: "You can't invite yourself — you're the account owner." });
    }

    // Does this email already have an EchoAI account?
    const existing = await db.query(
      "SELECT user_id FROM users WHERE lower(email) = $1",
      [email]
    );
    const existingUserId = existing.rows[0] ? existing.rows[0].user_id : null;

    if (existingUserId === ownerId) {
      return res
        .status(400)
        .json({ error: "You can't invite yourself — you're the account owner." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);

    await db.query(
      `INSERT INTO team_invitations
         (account_owner_user_id, invited_email, role, token, expires_at, phone)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ownerId, email, role, token, expiresAt, phone]
    );

    const status = existingUserId ? "active" : "pending";
    const acceptedAt = existingUserId ? new Date() : null;

    const upsert = await db.query(
      `INSERT INTO team_members
         (account_owner_user_id, invited_user_id, email, role, status, accepted_at, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (account_owner_user_id, lower(email)) DO UPDATE
         SET role = EXCLUDED.role,
             status = EXCLUDED.status,
             invited_user_id = COALESCE(EXCLUDED.invited_user_id, team_members.invited_user_id),
             accepted_at = EXCLUDED.accepted_at,
             phone = COALESCE(EXCLUDED.phone, team_members.phone),
             invited_at = NOW()
         WHERE team_members.status <> 'active'
       RETURNING *`,
      [ownerId, existingUserId, email, role, status, acceptedAt, phone]
    );

    if (upsert.rows.length === 0) {
      return res
        .status(409)
        .json({ error: "That person is already an active team member." });
    }

    const member = upsert.rows[0];

    // Send the appropriate email (best-effort — never fail the invite on SMTP).
    const businessName = owner ? owner.business_name : null;
    try {
      if (existingUserId) {
        const tpl = teamMemberAddedEmail({
          businessName,
          role,
          loginUrl: appBaseUrl(req),
        });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
      } else {
        const acceptUrl = `${appBaseUrl(req)}/?invite=${token}`;
        const tpl = teamInvitationEmail({
          businessName,
          role,
          acceptUrl,
          expiresHours: INVITE_TTL_HOURS,
        });
        await sendEmail({ to: email, subject: tpl.subject, html: tpl.html });
      }
    } catch (err) {
      console.error("Invitation email failed:", err.message);
    }

    // Recompute seats only when a seat was actually consumed (active now).
    let seats = null;
    if (status === "active") seats = await recomputeOwnerSeats(ownerId);

    return res.status(201).json({
      member: {
        teamMemberId: member.team_member_id,
        email: member.email,
        role: member.role,
        status: member.status,
        invitedAt: member.invited_at,
        acceptedAt: member.accepted_at,
      },
      linkedExistingUser: Boolean(existingUserId),
      seats,
    });
  } catch (err) {
    console.error("Invite member error:", err);
    return res
      .status(500)
      .json({ error: "Failed to send the invitation. Please try again." });
  }
}

/**
 * POST /api/team/accept  (auth only)
 * The invited person accepts via their one-time token. Single-use + expiry are
 * enforced by the conditional UPDATE on team_invitations.
 */
async function acceptInvitation(req, res) {
  const userId = req.user.actualUserId || req.user.userId;
  const userEmail = normalizeEmail(req.user.email);
  const token = String(req.body.token || "").trim();

  if (!token) {
    return res.status(400).json({ error: "An invitation token is required." });
  }

  try {
    // Look up the (unconsumed, unexpired) invitation WITHOUT burning it, so a
    // leaked token presented by the wrong user can't deny the real invitee.
    const lookup = await db.query(
      `SELECT account_owner_user_id, invited_email, role, phone
         FROM team_invitations
        WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()`,
      [token]
    );

    if (lookup.rows.length === 0) {
      return res
        .status(410)
        .json({ error: "This invitation is invalid, already used, or expired." });
    }

    const {
      account_owner_user_id: ownerId,
      invited_email,
      role,
      phone: invitePhone,
    } = lookup.rows[0];

    if (ownerId === userId) {
      return res
        .status(400)
        .json({ error: "You can't accept an invitation to your own workspace." });
    }

    // Confirm the caller's identity BEFORE consuming the token. A wrong-email
    // caller gets 403 and the invitation stays valid for the real recipient.
    if (normalizeEmail(invited_email) !== userEmail) {
      return res.status(403).json({
        error:
          "This invitation was sent to a different email address. Log in with that address to accept.",
      });
    }

    // Now atomically consume it (single-use + not expired). A concurrent accept
    // of the same token loses the race here and is treated as already used.
    const consumed = await db.query(
      `UPDATE team_invitations
          SET accepted_at = NOW()
        WHERE token = $1 AND accepted_at IS NULL AND expires_at > NOW()
        RETURNING invitation_id`,
      [token]
    );

    if (consumed.rows.length === 0) {
      return res
        .status(410)
        .json({ error: "This invitation is invalid, already used, or expired." });
    }

    await db.query(
      `INSERT INTO team_members
         (account_owner_user_id, invited_user_id, email, role, status, accepted_at, phone)
       VALUES ($1, $2, $3, $4, 'active', NOW(), $5)
       ON CONFLICT (account_owner_user_id, lower(email)) DO UPDATE
         SET invited_user_id = EXCLUDED.invited_user_id,
             status = 'active',
             accepted_at = NOW(),
             phone = COALESCE(EXCLUDED.phone, team_members.phone)`,
      [ownerId, userId, invited_email, role, invitePhone || null]
    );

    await recomputeOwnerSeats(ownerId);

    const owner = await getOwnerContext(ownerId);

    return res.json({
      accepted: true,
      role,
      businessName: owner ? owner.business_name : null,
    });
  } catch (err) {
    console.error("Accept invitation error:", err);
    return res
      .status(500)
      .json({ error: "Failed to accept the invitation. Please try again." });
  }
}

/**
 * GET /api/team  (auth, lockout, admin+)
 * Lists the owner's team members (active + pending) plus a seat/billing summary.
 */
async function listMembers(req, res) {
  const ownerId = req.user.userId;
  try {
    const { rows } = await db.query(
      `SELECT tm.team_member_id, tm.email, tm.role, tm.status, tm.phone,
              tm.invited_user_id, tm.invited_at, tm.accepted_at,
              u.email AS account_email
         FROM team_members tm
         LEFT JOIN users u ON u.user_id = tm.invited_user_id
        WHERE tm.account_owner_user_id = $1 AND tm.status <> 'removed'
        ORDER BY tm.invited_at DESC`,
      [ownerId]
    );

    // Weekly accountability stats, keyed by the member's real user id. Calls are
    // attributed to the agent who placed them; "leads worked" counts leads the
    // rep completed from their queue this week. Both are scoped to this owner's
    // workspace via the brand ownership join.
    const memberUserIds = rows
      .map((m) => m.invited_user_id)
      .filter((id) => id);
    const callStats = new Map();
    const leadStats = new Map();
    const lastActive = new Map();
    if (memberUserIds.length) {
      const { rows: cRows } = await db.query(
        `SELECT c.agent_user_id,
                COUNT(*) FILTER (WHERE c.created_at >= NOW() - INTERVAL '7 days')::int AS week_calls,
                MAX(c.created_at) AS last_call
           FROM calls c
           JOIN brands b ON b.brand_id = c.brand_id
          WHERE b.user_id = $1 AND c.agent_user_id = ANY($2::uuid[])
          GROUP BY c.agent_user_id`,
        [ownerId, memberUserIds]
      );
      cRows.forEach((r) => {
        callStats.set(r.agent_user_id, r.week_calls || 0);
        if (r.last_call) lastActive.set(r.agent_user_id, r.last_call);
      });

      const { rows: lRows } = await db.query(
        `SELECT l.assigned_rep_user_id,
                COUNT(*) FILTER (
                  WHERE l.queue_state = 'completed'
                    AND l.worked_at >= NOW() - INTERVAL '7 days'
                )::int AS week_leads,
                MAX(l.worked_at) AS last_worked
           FROM leads l
           JOIN brands b ON b.brand_id = l.brand_id
          WHERE b.user_id = $1 AND l.assigned_rep_user_id = ANY($2::uuid[])
          GROUP BY l.assigned_rep_user_id`,
        [ownerId, memberUserIds]
      );
      lRows.forEach((r) => {
        leadStats.set(r.assigned_rep_user_id, r.week_leads || 0);
        const prev = lastActive.get(r.assigned_rep_user_id);
        if (r.last_worked && (!prev || new Date(r.last_worked) > new Date(prev))) {
          lastActive.set(r.assigned_rep_user_id, r.last_worked);
        }
      });
    }

    const members = rows.map((m) => ({
      teamMemberId: m.team_member_id,
      email: m.account_email || m.email,
      role: m.role,
      status: m.status,
      phone: m.phone || null,
      invitedAt: m.invited_at,
      acceptedAt: m.accepted_at,
      lastActiveAt:
        (m.invited_user_id && lastActive.get(m.invited_user_id)) || m.accepted_at,
      weekCalls: (m.invited_user_id && callStats.get(m.invited_user_id)) || 0,
      weekLeadsWorked: (m.invited_user_id && leadStats.get(m.invited_user_id)) || 0,
    }));

    const owner = await getOwnerContext(ownerId);
    const tier = owner ? owner.subscription_tier : null;
    const activeMembers = members.filter((m) => m.status === "active").length;
    const teamSize = 1 + activeMembers;

    return res.json({
      members,
      seats: {
        teamSize,
        activeMembers,
        pendingInvites: members.filter((m) => m.status === "pending").length,
        tier,
        includedSeats: tier ? seatLimitFor(tier) : null,
        additionalSeats: tier ? additionalSeats(tier, teamSize) : 0,
        additionalSeatPrice: ADDITIONAL_SEAT_PRICE,
        monthlyTotal: tier ? computeMonthlyTotal(tier, teamSize) : null,
      },
    });
  } catch (err) {
    console.error("List team members error:", err);
    return res.status(500).json({ error: "Failed to load your team." });
  }
}

/**
 * POST /api/team/resend  (auth, lockout, admin+)
 * Reissues a fresh 48h token for a pending member and resends the email.
 */
async function resendInvite(req, res) {
  const ownerId = req.user.userId;
  const teamMemberId = String(req.body.teamMemberId || req.body.memberId || "").trim();

  if (!teamMemberId) {
    return res.status(400).json({ error: "A team member id is required." });
  }

  try {
    const memberRes = await db.query(
      `SELECT email, role, status FROM team_members
        WHERE team_member_id = $1 AND account_owner_user_id = $2`,
      [teamMemberId, ownerId]
    );
    const member = memberRes.rows[0];
    if (!member) {
      return res.status(404).json({ error: "Team member not found." });
    }
    if (member.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Only pending invitations can be resent." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);

    await db.query(
      `INSERT INTO team_invitations
         (account_owner_user_id, invited_email, role, token, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [ownerId, member.email, member.role, token, expiresAt]
    );

    const owner = await getOwnerContext(ownerId);
    try {
      const acceptUrl = `${appBaseUrl(req)}/?invite=${token}`;
      const tpl = teamInvitationEmail({
        businessName: owner ? owner.business_name : null,
        role: member.role,
        acceptUrl,
        expiresHours: INVITE_TTL_HOURS,
      });
      await sendEmail({ to: member.email, subject: tpl.subject, html: tpl.html });
    } catch (err) {
      console.error("Resend invitation email failed:", err.message);
    }

    return res.json({ resent: true });
  } catch (err) {
    console.error("Resend invite error:", err);
    return res.status(500).json({ error: "Failed to resend the invitation." });
  }
}

/**
 * PUT /api/team/role  (auth, lockout, admin+)
 * Changes a member's role. Does not affect seat count.
 */
async function changeRole(req, res) {
  const ownerId = req.user.userId;
  const teamMemberId = String(req.body.teamMemberId || req.body.memberId || "").trim();
  const role = String(req.body.role || "").trim();
  const rawPhone = req.body.phone;

  if (!teamMemberId) {
    return res.status(400).json({ error: "A team member id is required." });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `Role must be one of: ${ROLE_LABEL}.` });
  }

  let phone; // undefined = leave unchanged
  if (rawPhone !== undefined) {
    if (rawPhone === null || !String(rawPhone).trim()) {
      phone = null;
    } else {
      phone = normalizeE164(rawPhone);
      if (!phone) {
        return res.status(400).json({
          error: "Enter a valid phone number in E.164 format, e.g. +15551234567.",
        });
      }
    }
  }

  try {
    const existing = await db.query(
      `SELECT phone FROM team_members
        WHERE team_member_id = $1 AND account_owner_user_id = $2 AND status <> 'removed'`,
      [teamMemberId, ownerId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Team member not found." });
    }
    const effectivePhone = phone !== undefined ? phone : existing.rows[0].phone;
    if (role === "sales_rep" && !effectivePhone) {
      return res.status(400).json({
        error:
          "A sales rep needs a phone number so the platform can bridge their calls. Add one to switch this person to Sales Rep.",
      });
    }

    const { rows } = await db.query(
      `UPDATE team_members
          SET role = $1,
              phone = COALESCE($2, phone)
        WHERE team_member_id = $3 AND account_owner_user_id = $4 AND status <> 'removed'
        RETURNING team_member_id, email, role, status, phone`,
      [role, phone === undefined ? null : phone, teamMemberId, ownerId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Team member not found." });
    }
    return res.json({
      teamMemberId: rows[0].team_member_id,
      email: rows[0].email,
      role: rows[0].role,
      status: rows[0].status,
      phone: rows[0].phone || null,
    });
  } catch (err) {
    console.error("Change role error:", err);
    return res.status(500).json({ error: "Failed to change the role." });
  }
}

/**
 * POST /api/team/deactivate  (auth, lockout, admin+)
 * Deactivates a member: revokes access immediately (auth only remaps
 * status='active' members) while KEEPING the row and all their history —
 * calls, worked leads, and accountability logs stay attributed to them. Frees
 * their billed seat.
 */
async function deactivateMember(req, res) {
  const ownerId = req.user.userId;
  const teamMemberId = String(req.body.teamMemberId || req.body.memberId || "").trim();

  if (!teamMemberId) {
    return res.status(400).json({ error: "A team member id is required." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE team_members
          SET status = 'deactivated'
        WHERE team_member_id = $1 AND account_owner_user_id = $2 AND status = 'active'
        RETURNING team_member_id`,
      [teamMemberId, ownerId]
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Active team member not found." });
    }
    const seats = await recomputeOwnerSeats(ownerId);
    return res.json({ deactivated: true, seats });
  } catch (err) {
    console.error("Deactivate member error:", err);
    return res.status(500).json({ error: "Failed to deactivate the team member." });
  }
}

/**
 * POST /api/team/reactivate  (auth, lockout, admin+)
 * Restores a previously deactivated member to active (re-granting access) and
 * re-consumes a seat.
 */
async function reactivateMember(req, res) {
  const ownerId = req.user.userId;
  const teamMemberId = String(req.body.teamMemberId || req.body.memberId || "").trim();

  if (!teamMemberId) {
    return res.status(400).json({ error: "A team member id is required." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE team_members
          SET status = 'active', accepted_at = COALESCE(accepted_at, NOW())
        WHERE team_member_id = $1 AND account_owner_user_id = $2 AND status = 'deactivated'
        RETURNING team_member_id, invited_user_id`,
      [teamMemberId, ownerId]
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ error: "Deactivated team member not found." });
    }
    const seats = await recomputeOwnerSeats(ownerId);
    return res.json({ reactivated: true, seats });
  } catch (err) {
    console.error("Reactivate member error:", err);
    return res.status(500).json({ error: "Failed to reactivate the team member." });
  }
}

/**
 * DELETE /api/team/:teamMemberId  (auth, lockout, admin+)
 * Removes a member (revokes access immediately) and recomputes seats so the
 * next billing cycle is credited via Stripe proration.
 */
async function removeMember(req, res) {
  const ownerId = req.user.userId;
  const teamMemberId = String(req.params.teamMemberId || "").trim();

  if (!teamMemberId) {
    return res.status(400).json({ error: "A team member id is required." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE team_members
          SET status = 'removed', invited_user_id = NULL
        WHERE team_member_id = $1 AND account_owner_user_id = $2 AND status <> 'removed'
        RETURNING team_member_id`,
      [teamMemberId, ownerId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Team member not found." });
    }

    const seats = await recomputeOwnerSeats(ownerId);
    return res.json({ removed: true, seats });
  } catch (err) {
    console.error("Remove member error:", err);
    return res.status(500).json({ error: "Failed to remove the team member." });
  }
}

module.exports = {
  inviteMember,
  acceptInvitation,
  listMembers,
  resendInvite,
  changeRole,
  deactivateMember,
  reactivateMember,
  removeMember,
  recomputeOwnerSeats,
};

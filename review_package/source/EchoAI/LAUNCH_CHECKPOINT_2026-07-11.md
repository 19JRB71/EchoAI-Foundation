# PRE_LAUNCH_COST_AND_ROUTING_CHECKPOINT_2026_07_11

Rollback reference recorded before any launch-sprint cost-control changes.

## Git state (recorded 2026-07-12 00:30 UTC)

- Local HEAD: `0689ee6` — "Add a document outlining a multi-model AI strategy for Echo" (docs/assets only)
- GitHub `main` (deploys to Railway): `4d5f129` — "Add detailed audit of AI usage, voice pipeline, and recurring bugs"
- Last functional code commit (both local + GitHub): `c36ddd1` — "Apply the new Zorecho logo across the app"
- Working tree: clean except new attached-asset files. No launch branch created:
  Railway deploys from GitHub `main` and the owner pushes manually via the Git
  panel, so a side branch would break the deployment flow. Rollback = Replit
  checkpoint rollback, or reverting to this commit on `main`.

## Production deployment

- Host: Railway (nixpacks), deploys from GitHub `main`.
- Live check at recording time: `https://echoai-foundation-production.up.railway.app/`
  returned HTTP 200 (site up, Zorecho branding visible). `/api/healthz` is not a
  defined route (404 expected).
- Production runs `npm run start:prod` (migrate → build client → start server).

## Environment variables present (names only, values never recorded)

DATABASE_URL, JWT_SECRET, SESSION_SECRET, ENCRYPTION_KEY (boot-critical);
ANTHROPIC_API_KEY, NOUS_PORTAL_API_KEY, OPENAI_API_KEY, ELEVENLABS_API_KEY,
STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, FACEBOOK_APP_ID, FACEBOOK_APP_SECRET,
YOUTUBE_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD (feature vars).
NOTE: at recording time the SAME `ANTHROPIC_API_KEY` is used by both the Replit
development workspace and Railway production — this checkpoint precedes the
change that stops development from spending on it.

## Schedulers enabled at recording time (all unconditional, no environment guard)

31 cron jobs in `utils/scheduler.js`, including the AI-consuming set:
- Sage urgent scan — every 30 min, every real brand (144 Claude calls/day at 3 brands)
- Sage deep research — every 6 h per brand
- Competitor scan — every 6 h; Competitor ad scan — every 6 h; site monitor — daily 04:00
- Hourly health sweep (AI only when issues detected)
- Daily: goal tracking 05:45, health snapshots + briefing warm 06:00, autonomous
  growth 07:00, task sweep 09:00, beta sweep 09:30, closing summaries 18:00,
  autonomous summary 20:00
- Weekly (Mon): learning study 05:00, autopilot 06:30, self-review 07:15,
  analytics 08:00, cross-business intelligence 08:15
- Non-AI: social publish + reminders (every min), touchpoints/blasts (5 min),
  drip + quota sweep (hourly), email sweep + autonomous timeout (15 min),
  connection re-verify (6 h), real-estate automations (hourly/daily)

## Current AI billing state

- Anthropic credits exhausted / auto-reload disabled by owner on 2026-07-11 —
  production AI features currently return errors until billing is re-enabled.

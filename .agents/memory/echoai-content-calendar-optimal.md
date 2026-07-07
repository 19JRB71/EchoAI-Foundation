---
name: EchoAI content-calendar optimal scheduling
description: How the default per-platform "optimal" content-calendar cadence, no-consecutive-type guarantee, and timezone→UTC scheduling fit together.
---

# EchoAI content-calendar "optimal" scheduling

The default content-calendar cadence is a per-platform `PLATFORM_SCHEDULES` map
(prompts/contentCalendarPrompt.js): FB/IG/TikTok 3×/day, LinkedIn 1×/day morning,
YouTube 3×/week, at fixed windows `POSTING_WINDOWS` (08:00/12:00/18:00). The
frequency key is `"optimal"` and it is the client default.

**Rule: the no-consecutive-same-content-type guarantee is enforced in code, not
by the AI.** `computeSlots` builds all raw slots, sorts them chronologically,
then assigns `contentType` by strict modulo rotation over the 5 CONTENT_TYPES
(educational/promotional/inspirational/behind_the_scenes/engagement). Because
there are ≥2 types, adjacent slots can never repeat. The slot's `contentType` is
authoritative — it's passed into the prompt AND used when persisting, so model
drift can't break the invariant.
**Why:** the user explicitly required no two consecutive posts of the same type;
leaving it to the model is unreliable.

**Rule: any wall-clock cadence must convert brand-timezone → UTC.** The publisher
(socialController.publishDuePosts) selects `status='scheduled' AND scheduled_time
<= NOW()` where scheduled_time is TIMESTAMPTZ/UTC. So `scheduledTimeFor(day,
time, timezone)` uses `utils/timezone.zonedWallTimeToUtc` (DST-safe, Intl-based)
to turn "08:00 in America/New_York" into the correct UTC instant.
**How to apply:** never store a naive local time as scheduled_time; always run it
through zonedWallTimeToUtc with the brand's tz.

**Rule: getBrandTimezone must validate the stored tz and fall back to Eastern.**
It reads `availability_schedules.timezone`. `utils/timezone` falls back to **UTC**
on an invalid zone, but the product default is `America/New_York`, so the
controller validates with `isValidTimezone` and falls back to Eastern itself.

Generation is synchronous + batched: `generateCalendarPosts` splits slots into
fixed-size batches with a bounded worker pool (concurrency-limited), writing
results back by index to preserve global slot order. AI calls go through
`createMessage` (HEAVY timeout; upstream failure → 502, never mocked).

The setup-agent onboarding path deliberately stays on legacy `three_per_week`
(not `optimal`) so onboarding doesn't auto-generate ~300 posts.

**Rule: per-platform overrides live in a table but code stays the default source
of truth. TWO independent override axes: WINDOWS (when) and FREQUENCY (how
often).** Owners override each platform via `content_calendar_settings` (brand_id
UUID PK, `windows` JSONB + `frequencies` JSONB). Both only affect
`frequency === "optimal"` and are threaded as optional args through
`computeSlots`/`optimalRawSlots` (windows = 3rd arg, frequency = 4th arg,
backward compatible); a missing/empty platform falls back to its coded
`PLATFORM_SCHEDULES`. `windows` = the posting TIMES per day. `frequencies` =
`{platform:{cadence,perWeek?}}` where cadence is `daily`|`weekly`; a weekly
platform posts on `perWeek` (1..MAX_POSTS_PER_WEEK=7) days per rolling week, a
daily platform every day. Both sanitized on BOTH write and read
(`sanitizeWindows`, `sanitizeFrequencies`: validate/clamp, drop unknown platforms
& invalid cadences) so a stale/hostile row can't poison scheduling. The client
`PostingSettingsPanel` saves diff-only for BOTH maps (omits platforms equal to
default via `sameTimes`/`sameFreq`) so untouched platforms keep the default.
**Why:** keep the coded schedule as the durable default while letting owners tune
both timing and cadence; storing only real overrides means default changes still
propagate. **How to apply:** to change how *many* posts, edit frequency (cadence
+ perWeek); to change *when*, edit windows — they compose (weekly cadence + N
windows = N posts on each posting day).

**Rule: DST correctness is verified end-to-end, not just by conversion math.**
`test/contentCalendarDst.test.js` seeds real (isolated-DB) posts whose
`scheduled_time` is built via `zonedWallTimeToUtc` for winter (EST→13:00Z) and
summer (EDT→12:00Z) dates, then runs the REAL `publishDuePosts` and asserts which
rows are claimed (past→attempted/failed, future→left scheduled). Publisher fails
fast with no connected account (no network), so "reached failed" == "was selected
as due + ran the real path".

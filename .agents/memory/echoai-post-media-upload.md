---
name: EchoAI owner-uploaded post media
description: Real photo/video uploads for social posts — path allowlists, FB-only video, and the publish-claim column trap.
---

- Owner uploads land in `uploads/media/` with a random hex name derived from the VERIFIED mimetype (never client filename); schedule-time validation only accepts `/uploads/images/` (AI) or `/uploads/media/` (uploads) paths with no `..` — never a raw URL, or the publisher becomes an SSRF fetcher.
- A post carries a photo OR a video, never both; video posts are Facebook-only (published via Graph `{pageId}/videos` with `file_url`). Enforce the platform limit at schedule time with an honest 400, and in the client picker too.
- **Trap:** the `publishDuePosts` claim query's `RETURNING` list is the only data `publishStoredPost` sees. Any new media/behavior column on `social_posts` MUST be added there or scheduled posts silently publish without it. Regression test stubs db.query + socialApi.publishPost and asserts the claim SQL returns the column.
- Video publish fails honestly (throws) when no public base URL is configured — silently posting text-only would betray the post's whole point.

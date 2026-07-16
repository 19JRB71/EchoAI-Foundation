-- Autopilot is posts-only (product decision, July 2026): ads are Atlas's job
-- in Ad Campaigns. Generation no longer drafts ads, but batches drafted before
-- that change still carry pending ad drafts. Remove them so they stop showing
-- in the approval queue. Approved/launched ad history is left untouched.
DELETE FROM autopilot_batch_items
 WHERE item_type = 'ad'
   AND status = 'pending';

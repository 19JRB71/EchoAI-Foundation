-- The platform admin is addressed as "Sir" in all voice interactions.
-- Fill the preferred name only where it isn't already set, so an admin who
-- later chooses something else in Settings is never overwritten.
UPDATE users
   SET preferred_name = 'Sir'
 WHERE role = 'admin'
   AND (preferred_name IS NULL OR btrim(preferred_name) = '');

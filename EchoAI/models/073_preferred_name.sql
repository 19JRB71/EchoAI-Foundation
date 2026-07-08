-- 073_preferred_name.sql
-- What Echo should call the owner in conversation ("James", "Boss",
-- "Mr. Blacketer"…). Optional; when NULL Echo falls back to first_name, and the
-- platform admin falls back to "James".
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS preferred_name VARCHAR(120);

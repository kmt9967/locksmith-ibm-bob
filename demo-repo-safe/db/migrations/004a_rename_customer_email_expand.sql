SET lock_timeout = '3s';
-- Expand: add email_address column alongside email (dual-write phase)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_address text DEFAULT NULL;

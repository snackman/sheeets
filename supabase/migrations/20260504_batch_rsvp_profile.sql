-- Add extra profile fields for batch RSVP form pre-fill
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_name text;

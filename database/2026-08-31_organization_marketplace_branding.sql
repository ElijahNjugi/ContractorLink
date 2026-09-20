ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS logo_image_url text,
  ADD COLUMN IF NOT EXISTS profile_image_url text,
  ADD COLUMN IF NOT EXISTS cover_image_url text;

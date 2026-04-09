-- Add additional fields to accident_reports based on insurance company forms
ALTER TABLE public.accident_reports
  ADD COLUMN IF NOT EXISTS owner_address TEXT,
  ADD COLUMN IF NOT EXISTS driver_address TEXT,
  ADD COLUMN IF NOT EXISTS driver_age INTEGER,
  ADD COLUMN IF NOT EXISTS driver_occupation TEXT,
  ADD COLUMN IF NOT EXISTS license_issue_place TEXT,
  ADD COLUMN IF NOT EXISTS license_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS first_license_date DATE,
  ADD COLUMN IF NOT EXISTS vehicle_license_expiry DATE,
  ADD COLUMN IF NOT EXISTS passengers_count INTEGER,
  ADD COLUMN IF NOT EXISTS vehicle_usage_purpose TEXT,
  ADD COLUMN IF NOT EXISTS own_car_damages TEXT,
  ADD COLUMN IF NOT EXISTS was_anyone_injured BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS injuries_description TEXT,
  ADD COLUMN IF NOT EXISTS witnesses_info TEXT,
  ADD COLUMN IF NOT EXISTS passengers_info TEXT,
  ADD COLUMN IF NOT EXISTS responsible_party TEXT,
  ADD COLUMN IF NOT EXISTS additional_details TEXT;
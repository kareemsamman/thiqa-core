-- Add new enum values for non-car insurance categories
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'HEALTH';
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'LIFE';
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'PROPERTY';
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'TRAVEL';
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'BUSINESS';
ALTER TYPE policy_type_parent ADD VALUE IF NOT EXISTS 'OTHER';
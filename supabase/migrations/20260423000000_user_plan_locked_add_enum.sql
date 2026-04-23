-- =============================================================================
-- PLAN-LOCKED USER STATUS — step 1: add enum value
-- =============================================================================
-- Postgres disallows using a newly-added enum value inside the same
-- transaction that added it. So step 1 just ALTERs the enum; the
-- triggers that reference 'plan_locked' live in a follow-up migration
-- (20260423000100_user_plan_locked_triggers.sql).
-- =============================================================================

ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'plan_locked';

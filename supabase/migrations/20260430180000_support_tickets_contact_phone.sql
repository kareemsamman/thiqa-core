-- Demo-call lead capture: support_tickets needs to accept a phone
-- number alongside (or instead of) the email address.
--
-- The original public-ticket constraint required contact_email NOT
-- NULL for source='public'. The new "اطلب عرض توضيحي" CTA on the
-- public landing/pricing/faq pages collects a phone number first
-- (so a Thiqa rep can call back); email is optional.
--
-- Adjust the constraint so a public ticket needs contact_name + at
-- least one of (contact_email, contact_phone). Existing rows already
-- have contact_email, so they remain valid.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_source_fields_check;

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_source_fields_check CHECK (
    (source = 'public'
      AND agent_id IS NULL
      AND created_by_user_id IS NULL
      AND contact_name IS NOT NULL
      AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL))
    OR
    (source = 'agent'
      AND agent_id IS NOT NULL
      AND created_by_user_id IS NOT NULL)
  );

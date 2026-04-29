-- Public support tickets — relax support_tickets/messages so that
-- non-authenticated visitors can open a ticket via the /faq contact
-- form. The constraints exist to prevent agents from forging tickets
-- "as another agent"; they don't need to apply when a ticket is
-- explicitly inserted by the service-role edge function on behalf of
-- a public submitter.
--
-- Schema changes:
--   support_tickets.agent_id           NOT NULL → NULL  (public tickets have no agent)
--   support_tickets.created_by_user_id NOT NULL → NULL  (public tickets have no Supabase user)
--   support_tickets.contact_name       NEW       (display name from form)
--   support_tickets.contact_email      NEW       (where to email replies)
--   support_tickets.source             NEW       'agent' | 'public'
--   support_messages.author_user_id    NOT NULL → NULL  (initial public message has no user)
--
-- RLS additions:
--   - Super-admin can view & reply on any ticket regardless of source.
--     The existing super-admin clause in can_view_support_ticket
--     already covers SELECT; we add a similar one in support_messages
--     so super-admins can also reply (insert) on public tickets where
--     agent_id is NULL.

-- ─── Tickets ───────────────────────────────────────────────
ALTER TABLE public.support_tickets
  ALTER COLUMN agent_id DROP NOT NULL,
  ALTER COLUMN created_by_user_id DROP NOT NULL;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS contact_name  text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS source        text NOT NULL DEFAULT 'agent'
    CHECK (source IN ('agent', 'public'));

CREATE INDEX IF NOT EXISTS idx_support_tickets_source
  ON public.support_tickets (source, status, created_at DESC);

-- A public ticket needs contact info; an agent ticket needs agent + creator.
-- Encoded as a single CHECK so the rule is auditable in one place.
ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_source_fields_check;
ALTER TABLE public.support_tickets
  ADD  CONSTRAINT support_tickets_source_fields_check CHECK (
    (source = 'public'
      AND agent_id IS NULL
      AND created_by_user_id IS NULL
      AND contact_name IS NOT NULL
      AND contact_email IS NOT NULL)
    OR
    (source = 'agent'
      AND agent_id IS NOT NULL
      AND created_by_user_id IS NOT NULL)
  );

-- ─── Messages ──────────────────────────────────────────────
ALTER TABLE public.support_messages
  ALTER COLUMN author_user_id DROP NOT NULL;

ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS body_html text;
COMMENT ON COLUMN public.support_messages.body_html IS
  'Optional rich HTML body sent from the public /faq form. The plain `body` column always carries a stripped/text version for indexing and notifications. Agent-side replies leave this NULL.';

-- ─── Visibility helper update ──────────────────────────────
-- Public tickets have NULL agent_id, so the EXISTS clause that joins
-- user_roles by agent_id never matches. That's fine — by design only
-- the super-admin should see public tickets in the inbox. The
-- existing "is_super_admin → true" branch already covers it; nothing
-- to change in can_view_support_ticket.

-- ─── Allow super-admin to insert reply on public tickets ──
-- The existing INSERT policy on support_messages requires the caller
-- to satisfy can_view_support_ticket, which already grants super-admin
-- access. No extra RLS work needed for super-admins replying.

-- ─── Public-ticket inserts go through the edge function ──
-- We do NOT add an RLS policy that lets `anon` insert here. The
-- public-support-submit edge function uses the service role key, which
-- bypasses RLS entirely — keeping the surface area small and ensuring
-- input goes through server-side validation and rate-limiting.

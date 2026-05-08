-- Phase 1 of WhatsApp AI agent feature.
--
-- Refactor green_api_settings from "one row per agent" to "one row per
-- (agent, branch)" so an agency can run separate WhatsApp numbers per
-- branch (or one shared number for the whole agency by leaving
-- branch_id NULL).
--
-- Also:
--   * Tag chat sessions/messages with the receiving number's branch_id
--     so branch-scoped staff only see what concerns them.
--   * Add customer_requests table — every "agent should follow up with
--     this customer" event the bot creates lives here.
--   * Lock green_api_settings management to Thiqa super-admins. The
--     agency itself never sees the API tokens.

-- ── 1. green_api_settings refactor ───────────────────────────────────
-- Drop the "one row per agent" rule
ALTER TABLE public.green_api_settings
  DROP CONSTRAINT IF EXISTS green_api_settings_agent_unique;

-- Branch the row to a specific branch (NULL = agency-wide). Thiqa
-- admin can have multiple rows per agent: one per branch + optionally
-- one with NULL branch for agency-wide.
ALTER TABLE public.green_api_settings
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

-- Human-readable label so the requests/chats UI can say
-- "فرع رام الله — 0501234567" instead of just an instance ID.
ALTER TABLE public.green_api_settings
  ADD COLUMN IF NOT EXISTS phone_label text;

-- Display number (the actual WhatsApp number, for UI). Different from
-- the senderId used internally — this is what the agent sees on screen.
ALTER TABLE public.green_api_settings
  ADD COLUMN IF NOT EXISTS phone_number text;

-- Replace the old unique-per-agent rule with unique-per-(agent,branch).
-- Postgres doesn't treat NULLs as equal in a UNIQUE constraint, so we
-- coerce the NULL via COALESCE in a unique index. zero-uuid is a safe
-- sentinel since real branches use random uuids.
DROP INDEX IF EXISTS uniq_green_api_settings_agent_branch;
CREATE UNIQUE INDEX uniq_green_api_settings_agent_branch
  ON public.green_api_settings (
    agent_id,
    COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Tighten RLS: management is Thiqa super-admin only. Agency users do
-- NOT see API tokens. The webhook edge function uses the service role
-- which bypasses RLS, so it still works.
DROP POLICY IF EXISTS "Agent admins manage their green_api_settings" ON public.green_api_settings;
DROP POLICY IF EXISTS "Super admins manage green_api_settings" ON public.green_api_settings;
CREATE POLICY "Super admins manage green_api_settings"
  ON public.green_api_settings
  FOR ALL
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ── 2. customer_chat_sessions: branch tagging ────────────────────────
ALTER TABLE public.customer_chat_sessions
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_chat_sessions_agent_branch
  ON public.customer_chat_sessions(agent_id, branch_id);

-- Replace the read policy with branch-aware version. Rule:
--   * Anyone on the agent can see agency-wide sessions (branch_id IS NULL)
--   * Branch staff can see sessions tagged with their branch
--   * Admins (can_access_branch returns true for any branch_id) see all
DROP POLICY IF EXISTS "Agent users view their customer chat sessions" ON public.customer_chat_sessions;
CREATE POLICY "Agent users view their customer chat sessions"
  ON public.customer_chat_sessions
  FOR SELECT
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
    AND (
      branch_id IS NULL
      OR public.can_access_branch(auth.uid(), branch_id)
    )
  );

-- ── 3. customer_chat_messages: read via session join ─────────────────
-- The existing policy already joins through sessions, so once the
-- session policy is branch-aware the message policy inherits it. Just
-- redrop/recreate so the dependency is explicit and re-runnable.
DROP POLICY IF EXISTS "Agent users view their customer chat messages" ON public.customer_chat_messages;
CREATE POLICY "Agent users view their customer chat messages"
  ON public.customer_chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_chat_sessions s
      WHERE s.id = public.customer_chat_messages.session_id
        AND public.is_active_user(auth.uid())
        AND public.user_belongs_to_agent(auth.uid(), s.agent_id)
        AND (
          s.branch_id IS NULL
          OR public.can_access_branch(auth.uid(), s.branch_id)
        )
    )
  );

-- ── 4. customer_requests table ───────────────────────────────────────
-- Every "the bot promised the agent will follow up" event becomes one
-- of these rows. The agent staff handle it on the requests page.
CREATE TABLE IF NOT EXISTS public.customer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- Branch the request belongs to. NULL when the receiving WhatsApp
  -- number was agency-wide (visible to all staff in that agent).
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  -- The matched client (if any) — the bot does fuzzy-search and may
  -- not have a hit for new prospects.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Customer phone in international digits-only format, captured for
  -- traceability even when client_id is NULL.
  phone_number text NOT NULL,
  -- 'quote'    → asked for a price quote (المسؤول رح يتواصل)
  -- 'accident' → asked about how to handle an accident
  -- 'general'  → catch-all for "needs human follow-up"
  request_type text NOT NULL CHECK (request_type IN ('quote', 'accident', 'general')),
  -- One-line summary the bot extracts for the list view.
  title text NOT NULL,
  -- Full content (last few customer messages) for context when the
  -- agent opens the request.
  content text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'handled', 'closed')),
  -- Optional: which staff member picked this request up.
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Optional: which staff member resolved it.
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_requests_agent_status_created
  ON public.customer_requests(agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_requests_branch
  ON public.customer_requests(branch_id);

ALTER TABLE public.customer_requests ENABLE ROW LEVEL SECURITY;

-- Same branch-aware visibility rule as chat sessions
DROP POLICY IF EXISTS "Agent users view customer_requests" ON public.customer_requests;
CREATE POLICY "Agent users view customer_requests"
  ON public.customer_requests
  FOR SELECT
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
    AND (
      branch_id IS NULL
      OR public.can_access_branch(auth.uid(), branch_id)
    )
  );

-- Agent users can update status/assign/handle on requests they can see
DROP POLICY IF EXISTS "Agent users update customer_requests" ON public.customer_requests;
CREATE POLICY "Agent users update customer_requests"
  ON public.customer_requests
  FOR UPDATE
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
    AND (
      branch_id IS NULL
      OR public.can_access_branch(auth.uid(), branch_id)
    )
  )
  WITH CHECK (
    public.user_belongs_to_agent(auth.uid(), agent_id)
  );

-- Insertion happens only via the webhook (service role) — no client
-- INSERT policy is needed; service role bypasses RLS. Add an explicit
-- super-admin policy so manual seeding via SQL editor still works for
-- testing.
DROP POLICY IF EXISTS "Super admins insert customer_requests" ON public.customer_requests;
CREATE POLICY "Super admins insert customer_requests"
  ON public.customer_requests
  FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_customer_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_customer_requests_updated_at ON public.customer_requests;
CREATE TRIGGER trg_customer_requests_updated_at
  BEFORE UPDATE ON public.customer_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_customer_requests_updated_at();

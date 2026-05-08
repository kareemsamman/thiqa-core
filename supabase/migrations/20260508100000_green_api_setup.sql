-- WhatsApp customer-facing AI bot via Green API.
--
-- Schema:
--   green_api_settings        — per-agent Green API connection config
--   customer_chat_sessions    — one row per (agent, customer phone)
--   customer_chat_messages    — every inbound + outbound WhatsApp message
--
-- The webhook edge function (green-api-webhook) writes to these as
-- the service role; agent-side admin UIs read them via RLS.

-- ── 1. green_api_settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.green_api_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  -- Green API "instance" identifier (e.g. "1101000000"). Unique per
  -- agent — when an inbound webhook arrives we use this to figure out
  -- which Thiqa tenant the conversation belongs to.
  instance_id text NOT NULL,
  -- Token for outbound calls to https://api.green-api.com/...
  api_token_instance text NOT NULL,
  -- Master switch — when false, inbound webhooks are silently dropped
  -- and outbound messages are blocked.
  enabled boolean NOT NULL DEFAULT false,
  -- Optional per-agent additions to the customer-facing system prompt
  -- (office hours, tone overrides, special instructions, etc.).
  custom_prompt text,
  -- Optional fallback when the bot can't help; defaults to a generic
  -- "سأحوّلك للوكيل" message in code if NULL.
  fallback_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT green_api_settings_agent_unique UNIQUE (agent_id),
  CONSTRAINT green_api_settings_instance_unique UNIQUE (instance_id)
);

CREATE INDEX IF NOT EXISTS idx_green_api_settings_instance
  ON public.green_api_settings(instance_id);

ALTER TABLE public.green_api_settings ENABLE ROW LEVEL SECURITY;

-- Only admin users of an agent can read/write its Green API row. Mirrors
-- the same pattern used by sms_settings.
DROP POLICY IF EXISTS "Agent admins manage their green_api_settings" ON public.green_api_settings;
CREATE POLICY "Agent admins manage their green_api_settings"
  ON public.green_api_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.agent_id = public.green_api_settings.agent_id
        AND ur.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.agent_id = public.green_api_settings.agent_id
        AND ur.role = 'admin'
    )
  );

-- Service role bypasses RLS — used by the webhook edge function to look
-- up the config without an authenticated session.

-- ── 2. customer_chat_sessions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Customer's phone in international digits-only format (e.g. 972501234567)
  -- so we can correlate even when the linked clients row is later edited.
  phone_number text NOT NULL,
  -- Cached display name from the client record (or whatsapp profile)
  -- so chat logs read clearly even if the client was deleted later.
  display_name text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_chat_sessions_agent_phone_unique UNIQUE (agent_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_sessions_agent_last_msg
  ON public.customer_chat_sessions(agent_id, last_message_at DESC);

ALTER TABLE public.customer_chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agent users view their customer chat sessions" ON public.customer_chat_sessions;
CREATE POLICY "Agent users view their customer chat sessions"
  ON public.customer_chat_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.agent_id = public.customer_chat_sessions.agent_id
    )
  );

-- ── 3. customer_chat_messages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  -- 'customer' = inbound WhatsApp message from the user
  -- 'bot'      = AI-generated outbound reply
  -- 'agent'    = a human staff member sent this manually (future feature)
  role text NOT NULL CHECK (role IN ('customer', 'bot', 'agent')),
  content text NOT NULL,
  -- Green API's idMessage for traceability against their dashboard.
  whatsapp_message_id text,
  -- Free-form: { "intent": "...", "model": "...", "tool_calls": [...] }
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_chat_messages_session_created
  ON public.customer_chat_messages(session_id, created_at);

ALTER TABLE public.customer_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agent users view their customer chat messages" ON public.customer_chat_messages;
CREATE POLICY "Agent users view their customer chat messages"
  ON public.customer_chat_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.customer_chat_sessions s
      JOIN public.user_roles ur
        ON ur.agent_id = s.agent_id
       AND ur.user_id = auth.uid()
      WHERE s.id = public.customer_chat_messages.session_id
    )
  );

-- ── 4. updated_at trigger ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_green_api_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_green_api_settings_updated_at ON public.green_api_settings;
CREATE TRIGGER trg_green_api_settings_updated_at
  BEFORE UPDATE ON public.green_api_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_green_api_settings_updated_at();

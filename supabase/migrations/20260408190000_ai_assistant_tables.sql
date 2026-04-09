-- ============================================================
-- ثاقب (Thaqib) AI Assistant Tables
-- ============================================================

-- Chat sessions per user
CREATE TABLE public.ai_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.ai_chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat sessions"
  ON public.ai_chat_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX idx_ai_chat_sessions_user ON public.ai_chat_sessions(user_id, updated_at DESC);

-- Chat messages
CREATE TABLE public.ai_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chat messages"
  ON public.ai_chat_messages FOR ALL TO authenticated
  USING (
    session_id IN (SELECT id FROM public.ai_chat_sessions WHERE user_id = auth.uid())
  );

CREATE INDEX idx_ai_chat_messages_session ON public.ai_chat_messages(session_id, created_at ASC);

-- Service role access for edge functions
CREATE POLICY "Service can manage chat sessions"
  ON public.ai_chat_sessions FOR ALL TO service_role
  WITH CHECK (true);

CREATE POLICY "Service can manage chat messages"
  ON public.ai_chat_messages FOR ALL TO service_role
  WITH CHECK (true);

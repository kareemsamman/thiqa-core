-- Join subscription_plans, agents, and agent_feature_flags to the
-- supabase_realtime publication so the agent-side useAgentContext
-- hook receives UPDATE events when Thiqa admin toggles a plan's
-- default_features (ThiqaSettings), switches the agent's plan, or
-- flips a per-agent override in agent_feature_flags.
--
-- Without this, the agent's browser keeps the planInfo snapshot it
-- loaded at login, so feature-gating in PermissionRoute / Sidebar
-- stays stale until the user hard-refreshes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'subscription_plans'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.subscription_plans';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agents'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agents';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'agent_feature_flags'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_feature_flags';
  END IF;
END $$;

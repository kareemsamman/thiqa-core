-- Per-agent setting that controls WHEN the "client hasn't signed"
-- prompt appears in the policy wizard.
--
-- 'on_client_select' (default) — the existing behavior: the prompt fires
--   in step 1 right after the agent selects a client and presses next.
-- 'on_completion' — the prompt is suppressed during the wizard; instead
--   PolicySuccessDialog shows an extra "توقيع العميل" row at the end of
--   the transaction (only when the client doesn't already have a
--   signature on file).
--
-- Kept as a column on agents rather than a new settings table: it's one
-- field, naturally per-agency, and useAgentContext already fetches the
-- agents row so the read is free.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS signing_check_timing text NOT NULL DEFAULT 'on_client_select';

ALTER TABLE public.agents
  DROP CONSTRAINT IF EXISTS agents_signing_check_timing_check;

ALTER TABLE public.agents
  ADD CONSTRAINT agents_signing_check_timing_check
  CHECK (signing_check_timing IN ('on_client_select', 'on_completion'));

COMMENT ON COLUMN public.agents.signing_check_timing IS
  'When to surface the customer-signature prompt: on_client_select (in-wizard, current default) or on_completion (deferred to the post-save success dialog).';

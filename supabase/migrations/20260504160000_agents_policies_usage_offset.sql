-- Per-agent offset that's subtracted from the live "policies created
-- this period" count for the purpose of the per-month معاملة quota.
--
-- Use case: data was imported into an agent's account (manual seed,
-- migration from another system, Thiqa-side test data) and shouldn't
-- count against their plan cap. The agent should still see those
-- policies in every dashboard / report — only the usage tile and the
-- creation gate (useAgentLimits) treat them as "already there".
--
-- Default 0 means no offset → existing agents keep current behavior.
-- Setting the offset = current packages_this_month for an agent gives
-- them a clean "0 used" tile without touching the policy rows. As they
-- create new policies the actual count grows, so the displayed used
-- (= actual - offset) climbs from 0 the same way it would have.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS policies_usage_offset integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.agents.policies_usage_offset IS
  'Subtracted from policies_count_this_period for quota display + enforcement. Used when seed/test data was imported and shouldn''t count against the plan cap.';

-- Drop the 'ippbx' (Click2Call / PBX) and 'leads' (Whatsapp Leads)
-- feature keys from every plan's default_features map. They were
-- seeded into Ultimate and are no longer part of the surfaced feature
-- catalog — Thiqa admin removed them from the plan editor.
-- Leaving stale keys would let hasFeature() return true for agents
-- that shouldn't have them any more, so strip them out here too.

UPDATE public.subscription_plans
SET default_features = default_features - 'ippbx' - 'leads'
WHERE default_features ? 'ippbx'
   OR default_features ? 'leads';

-- Also drop any agent-level override rows that pinned these features
-- on (agent_feature_flags rows). No agent should have them toggled
-- explicitly now that the catalog excludes them.
DELETE FROM public.agent_feature_flags
WHERE feature_key IN ('ippbx', 'leads');

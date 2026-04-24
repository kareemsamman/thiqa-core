-- One-off: zero a.h.musaffer@gmail.com's SMS credit wallet.
--
-- Context: the pre-fix edge-function path in _shared/usage-limits.ts read
-- baseLimit from agent_usage_limits (defaulted to 200 by the test-migration
-- seed) instead of the real plan cap, so his SMS sends never tripped
-- log_usage_with_credit's wallet decrement. Result: used_this_month climbed
-- to 75 against a plan cap of 50 + a stale wallet of 5 credits that were
-- never consumed. Now that resolveLimitConfig calls get_agent_effective_limit,
-- the server would still hand him 5 free credits before blocking — which
-- is not what Thiqa wants, since the 25 overage sends already exhausted
-- what he paid for.
--
-- Hard-zeroing the wallet pulls him into the "fully blocked" state so the
-- useSmsLock/bar both render locked on the next fetch (realtime in
-- useAgentLimits picks up the wallet row change and refetches
-- automatically — no client refresh needed).
UPDATE public.agent_credit_wallet
   SET sms_credit_balance = 0,
       updated_at = now()
 WHERE agent_id IN (
   SELECT id FROM public.agents WHERE email = 'a.h.musaffer@gmail.com'
 );

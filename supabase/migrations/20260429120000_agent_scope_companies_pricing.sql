-- Tighten agent scoping for insurance_companies, pricing_rules, and
-- insurance_categories. These three tables had `agent_id` columns
-- added in 20260308081201 but their RLS policies were never updated
-- to filter by it — they only checked is_active_user(), which meant
-- any row with agent_id = NULL (or even agent_id = some other agent)
-- was visible to every authenticated user.
--
-- The companion edge-function change: seed-agent-data no longer seeds
-- sample companies / pricing for new agents (each agent now starts
-- empty). So this is a good moment to also delete the seven legacy
-- companies that the original 20251217082001 migration inserted with
-- NULL agent_id (Menora, Harel, Phoenix, etc.) — those rows were the
-- whole reason the bug was visible in the first place.

-- ── 1. insurance_companies ────────────────────────────────────────
-- Drop legacy rows with NULL agent_id that were leaking across agents.
-- pricing_rules cascades via FK; clean up the dependent prices tables
-- explicitly to avoid FK errors (those tables don't have ON DELETE
-- CASCADE on company_id in every project).
DELETE FROM public.company_road_service_prices
WHERE company_id IN (SELECT id FROM public.insurance_companies WHERE agent_id IS NULL);

DELETE FROM public.company_accident_fee_prices
WHERE company_id IN (SELECT id FROM public.insurance_companies WHERE agent_id IS NULL);

DELETE FROM public.pricing_rules WHERE agent_id IS NULL;

DELETE FROM public.insurance_companies WHERE agent_id IS NULL;

DROP POLICY IF EXISTS "Active users can view companies" ON public.insurance_companies;
DROP POLICY IF EXISTS "Admins can manage companies" ON public.insurance_companies;
DROP POLICY IF EXISTS "Active users can manage companies" ON public.insurance_companies;

CREATE POLICY "Agent users can view insurance_companies"
  ON public.insurance_companies FOR SELECT
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

CREATE POLICY "Agent users can manage insurance_companies"
  ON public.insurance_companies FOR ALL
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  )
  WITH CHECK (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

-- ── 2. pricing_rules ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Active users can view pricing rules" ON public.pricing_rules;
DROP POLICY IF EXISTS "Admins can manage pricing rules" ON public.pricing_rules;
DROP POLICY IF EXISTS "Active users can manage pricing rules" ON public.pricing_rules;

CREATE POLICY "Agent users can view pricing_rules"
  ON public.pricing_rules FOR SELECT
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

CREATE POLICY "Agent users can manage pricing_rules"
  ON public.pricing_rules FOR ALL
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  )
  WITH CHECK (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

-- ── 3. insurance_categories ───────────────────────────────────────
-- Same fix. Categories ARE seeded for new agents (slug-keyed), so
-- legacy NULL rows from earlier migrations should also go.
DELETE FROM public.insurance_categories WHERE agent_id IS NULL;

DROP POLICY IF EXISTS "Active users can view insurance_categories" ON public.insurance_categories;
DROP POLICY IF EXISTS "Admins can manage insurance_categories" ON public.insurance_categories;
DROP POLICY IF EXISTS "Active users can manage insurance_categories" ON public.insurance_categories;

CREATE POLICY "Agent users can view insurance_categories"
  ON public.insurance_categories FOR SELECT
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

CREATE POLICY "Agent users can manage insurance_categories"
  ON public.insurance_categories FOR ALL
  TO authenticated
  USING (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  )
  WITH CHECK (
    public.is_active_user(auth.uid())
    AND public.user_belongs_to_agent(auth.uid(), agent_id)
  );

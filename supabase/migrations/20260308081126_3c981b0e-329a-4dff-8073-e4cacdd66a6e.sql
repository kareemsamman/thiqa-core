
-- ============================================
-- PHASE 1: Multi-Tenant Foundation Tables
-- ============================================

-- 1. Agents table (insurance agencies subscribing to Thiqa)
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_ar text,
  email text UNIQUE NOT NULL,
  phone text,
  logo_url text,
  plan text NOT NULL DEFAULT 'basic' CHECK (plan IN ('basic', 'pro')),
  subscription_status text NOT NULL DEFAULT 'active' CHECK (subscription_status IN ('active', 'suspended', 'expired')),
  subscription_expires_at timestamptz,
  monthly_price numeric DEFAULT 300,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Agent-User mapping (maps auth.users → agent)
CREATE TABLE public.agent_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- 3. Feature flags per agent
CREATE TABLE public.agent_feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean DEFAULT true,
  UNIQUE(agent_id, feature_key)
);

-- 4. Subscription payment log
CREATE TABLE public.agent_subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  plan text NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  received_by uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- Helper Functions for Multi-Tenancy
-- ============================================

-- Get agent_id for current user (SECURITY DEFINER to bypass RLS)
CREATE OR REPLACE FUNCTION public.get_user_agent_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT agent_id FROM agent_users WHERE user_id = _user_id LIMIT 1
$$;

-- Check if a row's agent_id matches the user's agent
-- Thiqa super admin (no agent_users row) sees everything
CREATE OR REPLACE FUNCTION public.agent_matches(_user_id uuid, _row_agent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- Thiqa super admin bypasses agent check
    is_super_admin(_user_id)
    OR
    -- Row has no agent_id yet (legacy data)
    _row_agent_id IS NULL
    OR
    -- User's agent matches the row's agent
    (SELECT agent_id FROM agent_users WHERE user_id = _user_id LIMIT 1) = _row_agent_id
$$;

-- Check if user's agent subscription is active
CREATE OR REPLACE FUNCTION public.is_agent_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    -- Super admin always active
    is_super_admin(_user_id)
    OR
    -- User has no agent (legacy/transition)
    NOT EXISTS (SELECT 1 FROM agent_users WHERE user_id = _user_id)
    OR
    -- Agent subscription is active
    EXISTS (
      SELECT 1 FROM agents a
      JOIN agent_users au ON au.agent_id = a.id
      WHERE au.user_id = _user_id
      AND a.subscription_status = 'active'
    )
$$;

-- ============================================
-- RLS for new tables
-- ============================================
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_subscription_payments ENABLE ROW LEVEL SECURITY;

-- Agents: super admin can do everything, agent users can view their own
CREATE POLICY "Super admin full access on agents"
  ON public.agents FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Agent users can view their own agent"
  ON public.agents FOR SELECT TO authenticated
  USING (id = get_user_agent_id(auth.uid()));

-- Agent users: super admin full, users see own mapping
CREATE POLICY "Super admin full access on agent_users"
  ON public.agent_users FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Users can view own agent mapping"
  ON public.agent_users FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Feature flags: super admin manages, agent users read own
CREATE POLICY "Super admin full access on agent_feature_flags"
  ON public.agent_feature_flags FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Agent users can view own feature flags"
  ON public.agent_feature_flags FOR SELECT TO authenticated
  USING (agent_id = get_user_agent_id(auth.uid()));

-- Subscription payments: super admin only
CREATE POLICY "Super admin full access on agent_subscription_payments"
  ON public.agent_subscription_payments FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

-- Indexes
CREATE INDEX idx_agent_users_user_id ON public.agent_users(user_id);
CREATE INDEX idx_agent_users_agent_id ON public.agent_users(agent_id);
CREATE INDEX idx_agent_feature_flags_agent_id ON public.agent_feature_flags(agent_id);
CREATE INDEX idx_agent_subscription_payments_agent_id ON public.agent_subscription_payments(agent_id);
CREATE INDEX idx_agents_subscription_status ON public.agents(subscription_status);

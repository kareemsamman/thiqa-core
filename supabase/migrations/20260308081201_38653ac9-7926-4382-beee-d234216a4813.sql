
-- ============================================
-- PHASE 2: Add agent_id to ALL business tables
-- All nullable to not break existing data
-- ============================================

-- Core business tables
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policy_payments ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policy_groups ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.insurance_companies ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.insurance_company_groups ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.pricing_rules ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.insurance_categories ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.brokers ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.broker_settlements ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.broker_settlement_items ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.company_settlements ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.ab_ledger ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- User/branch tables
ALTER TABLE public.branches ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Client sub-tables
ALTER TABLE public.client_payments ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.client_debits ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.client_notes ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.client_children ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.customer_wallet_transactions ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.customer_signatures ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Accident tables
ALTER TABLE public.car_accidents ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_reports ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_third_parties ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_report_files ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_report_notes ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_report_reminders ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_injured_persons ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Communication tables
ALTER TABLE public.correspondence_letters ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.business_contacts ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.sms_logs ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.automated_sms_log ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.marketing_sms_campaigns ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.marketing_sms_recipients ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Misc tables
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.media_files ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.road_services ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.accident_fee_services ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.company_road_service_prices ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.company_accident_fee_prices ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.company_accident_templates ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.outside_cheques ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Settings tables (per-agent settings)
ALTER TABLE public.auth_settings ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.site_settings ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.sms_settings ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.payment_settings ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.xservice_settings ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.pbx_extensions ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Templates and forms
ALTER TABLE public.form_template_files ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.form_template_folders ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.invoice_templates ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.lead_messages ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Claims
ALTER TABLE public.repair_claims ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.repair_claim_notes ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.repair_claim_reminders ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Policy sub-tables
ALTER TABLE public.policy_children ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policy_reminders ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policy_renewal_tracking ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.policy_transfers ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);
ALTER TABLE public.payment_images ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Settlement supplements
ALTER TABLE public.settlement_supplements ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- Announcements (platform-level, but agent_id for agent-specific ones)
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES public.agents(id);

-- ============================================
-- Indexes for agent_id on high-traffic tables
-- ============================================
CREATE INDEX IF NOT EXISTS idx_clients_agent_id ON public.clients(agent_id);
CREATE INDEX IF NOT EXISTS idx_cars_agent_id ON public.cars(agent_id);
CREATE INDEX IF NOT EXISTS idx_policies_agent_id ON public.policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_policy_payments_agent_id ON public.policy_payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_brokers_agent_id ON public.brokers(agent_id);
CREATE INDEX IF NOT EXISTS idx_insurance_companies_agent_id ON public.insurance_companies(agent_id);
CREATE INDEX IF NOT EXISTS idx_ab_ledger_agent_id ON public.ab_ledger(agent_id);
CREATE INDEX IF NOT EXISTS idx_expenses_agent_id ON public.expenses(agent_id);
CREATE INDEX IF NOT EXISTS idx_branches_agent_id ON public.branches(agent_id);
CREATE INDEX IF NOT EXISTS idx_profiles_agent_id ON public.profiles(agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_id ON public.tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_agent_id ON public.notifications(agent_id);
CREATE INDEX IF NOT EXISTS idx_accident_reports_agent_id ON public.accident_reports(agent_id);
CREATE INDEX IF NOT EXISTS idx_repair_claims_agent_id ON public.repair_claims(agent_id);

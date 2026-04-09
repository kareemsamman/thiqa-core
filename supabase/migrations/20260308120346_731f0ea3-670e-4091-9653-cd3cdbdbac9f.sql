
-- Step 1: Create functions
CREATE OR REPLACE FUNCTION public.user_belongs_to_agent(_user_id uuid, _agent_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN _agent_id IS NULL THEN true
    ELSE EXISTS (SELECT 1 FROM public.agent_users WHERE user_id = _user_id AND agent_id = _agent_id)
  END
$$;

CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _user_agent_id uuid; _branch_agent_id uuid;
BEGIN
  SELECT agent_id INTO _user_agent_id FROM public.agent_users WHERE user_id = _user_id LIMIT 1;
  IF _branch_id IS NOT NULL THEN
    SELECT agent_id INTO _branch_agent_id FROM public.branches WHERE id = _branch_id;
    IF _branch_agent_id IS NOT NULL AND _user_agent_id IS NOT NULL AND _branch_agent_id != _user_agent_id THEN RETURN false; END IF;
  END IF;
  IF public.has_role(_user_id, 'admin') THEN RETURN true; END IF;
  IF _branch_id IS NULL THEN RETURN false; END IF;
  RETURN (SELECT branch_id FROM public.profiles WHERE id = _user_id) = _branch_id;
END;
$$;

-- Step 2: Tables with branch_id - use both checks
DROP POLICY IF EXISTS "Branch users can view clients" ON clients;
DROP POLICY IF EXISTS "Branch users can manage clients" ON clients;
CREATE POLICY "Branch users can view clients" ON clients FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage clients" ON clients FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view cars" ON cars;
DROP POLICY IF EXISTS "Branch users can manage cars" ON cars;
CREATE POLICY "Branch users can view cars" ON cars FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage cars" ON cars FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view policies" ON policies;
DROP POLICY IF EXISTS "Branch users can manage policies" ON policies;
CREATE POLICY "Branch users can view policies" ON policies FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage policies" ON policies FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view policy_payments" ON policy_payments;
DROP POLICY IF EXISTS "Branch users can manage policy_payments" ON policy_payments;
CREATE POLICY "Branch users can view policy_payments" ON policy_payments FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Branch users can manage policy_payments" ON policy_payments FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view broker_settlements" ON broker_settlements;
DROP POLICY IF EXISTS "Branch users can manage broker_settlements" ON broker_settlements;
CREATE POLICY "Agent users can view broker_settlements" ON broker_settlements FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage broker_settlements" ON broker_settlements FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view ab_ledger" ON ab_ledger;
DROP POLICY IF EXISTS "Branch users can manage ab_ledger" ON ab_ledger;
CREATE POLICY "Agent users can view ab_ledger" ON ab_ledger FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage ab_ledger" ON ab_ledger FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view accident_reports" ON accident_reports;
DROP POLICY IF EXISTS "Branch users can manage accident_reports" ON accident_reports;
CREATE POLICY "Agent users can view accident_reports" ON accident_reports FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage accident_reports" ON accident_reports FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view media_files" ON media_files;
DROP POLICY IF EXISTS "Branch users can manage media_files" ON media_files;
CREATE POLICY "Agent users can view media_files" ON media_files FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage media_files" ON media_files FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view outside_cheques" ON outside_cheques;
DROP POLICY IF EXISTS "Branch users can manage outside_cheques" ON outside_cheques;
CREATE POLICY "Agent users can view outside_cheques" ON outside_cheques FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage outside_cheques" ON outside_cheques FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view car_accidents" ON car_accidents;
DROP POLICY IF EXISTS "Branch users can manage car_accidents" ON car_accidents;
CREATE POLICY "Agent users can view car_accidents" ON car_accidents FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage car_accidents" ON car_accidents FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view invoices" ON invoices;
DROP POLICY IF EXISTS "Branch users can manage invoices" ON invoices;
CREATE POLICY "Agent users can view invoices" ON invoices FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage invoices" ON invoices FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

DROP POLICY IF EXISTS "Branch users can view sms_logs" ON sms_logs;
DROP POLICY IF EXISTS "Branch users can manage sms_logs" ON sms_logs;
CREATE POLICY "Agent users can view sms_logs" ON sms_logs FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));
CREATE POLICY "Agent users can manage sms_logs" ON sms_logs FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id) AND can_access_branch(auth.uid(), branch_id));

-- Step 3: Tables WITHOUT branch_id - agent-only check
DROP POLICY IF EXISTS "Branch users can view brokers" ON brokers;
DROP POLICY IF EXISTS "Branch users can manage brokers" ON brokers;
CREATE POLICY "Agent users can view brokers" ON brokers FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage brokers" ON brokers FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view policy_groups" ON policy_groups;
DROP POLICY IF EXISTS "Branch users can manage policy_groups" ON policy_groups;
CREATE POLICY "Agent users can view policy_groups" ON policy_groups FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage policy_groups" ON policy_groups FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view accident_third_parties" ON accident_third_parties;
DROP POLICY IF EXISTS "Branch users can manage accident_third_parties" ON accident_third_parties;
CREATE POLICY "Agent users can view accident_third_parties" ON accident_third_parties FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage accident_third_parties" ON accident_third_parties FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view client_children" ON client_children;
DROP POLICY IF EXISTS "Branch users can manage client_children" ON client_children;
CREATE POLICY "Agent users can view client_children" ON client_children FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage client_children" ON client_children FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view client_notes" ON client_notes;
DROP POLICY IF EXISTS "Branch users can manage client_notes" ON client_notes;
CREATE POLICY "Agent users can view client_notes" ON client_notes FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage client_notes" ON client_notes FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view broker_settlement_items" ON broker_settlement_items;
DROP POLICY IF EXISTS "Branch users can manage broker_settlement_items" ON broker_settlement_items;
CREATE POLICY "Agent users can view broker_settlement_items" ON broker_settlement_items FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage broker_settlement_items" ON broker_settlement_items FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view payment_images" ON payment_images;
DROP POLICY IF EXISTS "Branch users can manage payment_images" ON payment_images;
CREATE POLICY "Agent users can view payment_images" ON payment_images FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage payment_images" ON payment_images FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view policy_children" ON policy_children;
DROP POLICY IF EXISTS "Branch users can manage policy_children" ON policy_children;
CREATE POLICY "Agent users can view policy_children" ON policy_children FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage policy_children" ON policy_children FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view policy_renewal_tracking" ON policy_renewal_tracking;
DROP POLICY IF EXISTS "Branch users can manage policy_renewal_tracking" ON policy_renewal_tracking;
CREATE POLICY "Agent users can view policy_renewal_tracking" ON policy_renewal_tracking FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage policy_renewal_tracking" ON policy_renewal_tracking FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view policy_reminders" ON policy_reminders;
DROP POLICY IF EXISTS "Branch users can manage policy_reminders" ON policy_reminders;
CREATE POLICY "Agent users can view policy_reminders" ON policy_reminders FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage policy_reminders" ON policy_reminders FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view company_settlements" ON company_settlements;
DROP POLICY IF EXISTS "Branch users can manage company_settlements" ON company_settlements;
CREATE POLICY "Agent users can view company_settlements" ON company_settlements FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage company_settlements" ON company_settlements FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view customer_signatures" ON customer_signatures;
DROP POLICY IF EXISTS "Branch users can manage customer_signatures" ON customer_signatures;
CREATE POLICY "Agent users can view customer_signatures" ON customer_signatures FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage customer_signatures" ON customer_signatures FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view policy_transfers" ON policy_transfers;
DROP POLICY IF EXISTS "Branch users can manage policy_transfers" ON policy_transfers;
CREATE POLICY "Agent users can view policy_transfers" ON policy_transfers FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage policy_transfers" ON policy_transfers FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

DROP POLICY IF EXISTS "Branch users can view customer_wallet_transactions" ON customer_wallet_transactions;
DROP POLICY IF EXISTS "Branch users can manage customer_wallet_transactions" ON customer_wallet_transactions;
CREATE POLICY "Agent users can view customer_wallet_transactions" ON customer_wallet_transactions FOR SELECT USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));
CREATE POLICY "Agent users can manage customer_wallet_transactions" ON customer_wallet_transactions FOR ALL USING (is_active_user(auth.uid()) AND user_belongs_to_agent(auth.uid(), agent_id));

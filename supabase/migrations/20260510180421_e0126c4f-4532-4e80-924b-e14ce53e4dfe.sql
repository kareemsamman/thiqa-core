DO $$
DECLARE
  agent uuid := 'f37f11e5-6b05-4948-bd1a-c9a490eeb20e';
  grp record;
  keep_id uuid;
  dup_ids uuid[];
  tbl text;
  fk_tables text[] := ARRAY['cars','policy_groups','policies','sms_logs','accident_reports',
    'automated_sms_log','client_children','client_debits','client_notes','client_payments',
    'customer_signatures','customer_wallet_transactions','marketing_sms_recipients',
    'policy_transfers','repair_claims','renewal_followups','customer_requests','customer_chat_sessions'];
BEGIN
  FOR grp IN
    SELECT full_name, phone_number, array_agg(id ORDER BY created_at) AS ids
    FROM clients WHERE agent_id=agent
    GROUP BY full_name, phone_number HAVING COUNT(*)>1
  LOOP
    keep_id := grp.ids[1];
    dup_ids := grp.ids[2:array_length(grp.ids,1)];
    FOREACH tbl IN ARRAY fk_tables LOOP
      EXECUTE format('UPDATE public.%I SET client_id=$1 WHERE client_id = ANY($2)', tbl)
        USING keep_id, dup_ids;
    END LOOP;
    DELETE FROM public.clients WHERE id = ANY(dup_ids);
  END LOOP;
END $$;

DO $$
DECLARE
  v_car_id uuid := 'ae69ceda-9e78-43ab-b457-dc5b78439c6b';
  v_policy_ids uuid[];
  v_accident_ids uuid[];
BEGIN
  -- Collect policy ids for this car (including any group members)
  SELECT array_agg(DISTINCT id) INTO v_policy_ids
  FROM policies
  WHERE car_id = v_car_id
     OR group_id IN (SELECT group_id FROM policies WHERE car_id = v_car_id AND group_id IS NOT NULL);

  IF v_policy_ids IS NOT NULL THEN
    -- Unlock locked payments
    UPDATE policy_payments SET locked = false WHERE policy_id = ANY(v_policy_ids) AND locked = true;
    DELETE FROM policy_payments WHERE policy_id = ANY(v_policy_ids);
    DELETE FROM ab_ledger WHERE policy_id = ANY(v_policy_ids);
    DELETE FROM customer_wallet_transactions WHERE policy_id = ANY(v_policy_ids);
    DELETE FROM customer_signatures WHERE policy_id = ANY(v_policy_ids);
    UPDATE media_files SET deleted_at = now() WHERE entity_id = ANY(v_policy_ids) AND entity_type = 'policy';

    SELECT array_agg(id) INTO v_accident_ids FROM accident_reports WHERE policy_id = ANY(v_policy_ids);
    IF v_accident_ids IS NOT NULL THEN
      DELETE FROM accident_third_parties WHERE accident_report_id = ANY(v_accident_ids);
      DELETE FROM accident_reports WHERE policy_id = ANY(v_policy_ids);
    END IF;

    DELETE FROM broker_settlement_items WHERE policy_id = ANY(v_policy_ids);
    DELETE FROM policy_transfers WHERE policy_id = ANY(v_policy_ids) OR new_policy_id = ANY(v_policy_ids);
    UPDATE policies SET transferred_from_policy_id = NULL WHERE transferred_from_policy_id = ANY(v_policy_ids);

    DELETE FROM policies WHERE id = ANY(v_policy_ids);
  END IF;

  -- Soft-delete car media
  UPDATE media_files SET deleted_at = now() WHERE entity_id = v_car_id AND entity_type = 'car';
  DELETE FROM cars WHERE id = v_car_id;
END $$;

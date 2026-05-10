DO $$
DECLARE
  v_agent uuid := 'f37f11e5-6b05-4948-bd1a-c9a490eeb20e';
  v_client uuid := gen_random_uuid();
  v_car uuid := gen_random_uuid();
  v_group uuid := gen_random_uuid();
  v_full uuid := gen_random_uuid();
  v_road uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.clients (id, full_name, id_number, phone_number, agent_id, notes)
  VALUES (v_client, 'נור אלדין אבו פילאת', 'TMP-414-69-901', '050-742-6002', v_agent, 'Imported from Excel - no ID provided');

  INSERT INTO public.cars (id, client_id, car_number, manufacturer_name, model, model_number, year, color, license_type, license_expiry, car_type, agent_id)
  VALUES (v_car, v_client, '41469901', 'קיה', 'NIRO', '1264', 2018, 'טורקיז מטאלי', 'פרטי', '2026-07-31', 'car', v_agent);

  INSERT INTO public.policy_groups (id, client_id, agent_id) VALUES (v_group, v_client, v_agent)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.policies (id, client_id, car_id, company_id, policy_type_parent, policy_type_child, start_date, end_date, insurance_price, payed_for_company, profit, group_id, agent_id, manual_override, skip_recalc, office_commission, issue_date)
  VALUES (v_full, v_client, v_car, 'fea330d6-92e5-4c26-8439-605c0a8044ee', 'THIRD_FULL', 'FULL', '2026-01-04', '2026-12-31', 3300, 2135, 1165, v_group, v_agent, true, true, 0, '2025-12-31');

  INSERT INTO public.policies (id, client_id, car_id, company_id, policy_type_parent, start_date, end_date, insurance_price, payed_for_company, profit, road_service_id, group_id, agent_id, manual_override, skip_recalc, office_commission, issue_date)
  VALUES (v_road, v_client, v_car, '0b56bdd6-0107-4f74-96c5-75e7b035b721', 'ROAD_SERVICE', '2026-01-04', '2026-12-31', 0, 0, 0, '0f254536-9fc5-470d-b718-fbbfdbd7d07f', v_group, v_agent, true, true, 0, '2025-12-31');

  INSERT INTO public.policy_payments (policy_id, payment_type, amount, payment_date, agent_id, notes, source)
  VALUES (v_full, 'cash', 3300, '2025-12-31', v_agent, 'Imported from Excel - originally cheque', 'user');
END $$;
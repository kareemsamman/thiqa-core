DO $$
DECLARE
  v_agent uuid := 'f37f11e5-6b05-4948-bd1a-c9a490eeb20e';
  v_aradi uuid := 'fea330d6-92e5-4c26-8439-605c0a8044ee';
  v_klal uuid := 'd834308c-ce95-4f0c-bc88-b2c56459071f';
  v_menorah uuid := 'd2ce9dc4-8fcd-4849-a4f3-75f6c3193962';
  v_tiktak uuid := '0b56bdd6-0107-4f74-96c5-75e7b035b721';
  rs_450 uuid := '0f254536-9fc5-470d-b718-fbbfdbd7d07f';
  rs_120 uuid := 'd4566cff-6a24-4b73-892b-700be7adf1a5';
  rs_300 uuid := 'b0d96bee-014b-45bf-8c83-b458f324c39e';
  v_client uuid; v_car uuid; v_group uuid; v_pol uuid;
BEGIN
  -- Row 2: אמגד גמגום, MAZDA 3 2017, FULL no mandatory
  v_client:=gen_random_uuid(); v_car:=gen_random_uuid(); v_group:=gen_random_uuid(); v_pol:=gen_random_uuid();
  INSERT INTO clients(id,full_name,id_number,phone_number,agent_id,notes) VALUES
    (v_client,'אמגד גמגום','TMP-45-621-55','050-742-6002',v_agent,'Imported from Excel - no ID');
  INSERT INTO cars(id,client_id,car_number,manufacturer_name,model,model_number,year,color,license_type,license_expiry,car_type,agent_id) VALUES
    (v_car,v_client,'4562155','מזדה יפן','MAZDA 3','BN627',2017,'אפור','פרטי','2026-07-04','car',v_agent);
  INSERT INTO policy_groups(id,client_id,agent_id) VALUES(v_group,v_client,v_agent);
  INSERT INTO policies(id,client_id,car_id,company_id,policy_type_parent,policy_type_child,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_pol,v_client,v_car,v_aradi,'THIRD_FULL','FULL','2026-01-04','2026-12-31',3300,1884,966,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,road_service_id,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_tiktak,'ROAD_SERVICE','2026-01-04','2026-12-31',0,0,0,rs_450,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policy_payments(policy_id,payment_type,amount,payment_date,agent_id,notes,source) VALUES
    (v_pol,'cash',3300,'2025-12-31',v_agent,'Imported from Excel - originally cheque','user');

  -- Row 3: נגוא זגייר, OCTAVIA 2018, FULL with mandatory=כלל
  v_client:=gen_random_uuid(); v_car:=gen_random_uuid(); v_group:=gen_random_uuid(); v_pol:=gen_random_uuid();
  INSERT INTO clients(id,full_name,id_number,phone_number,agent_id,notes) VALUES
    (v_client,'נגוא זגייר','TMP-387-24-401','050-742-6002',v_agent,'Imported from Excel - no ID');
  INSERT INTO cars(id,client_id,car_number,manufacturer_name,model,model_number,year,color,license_type,license_expiry,car_type,agent_id) VALUES
    (v_car,v_client,'38724401','סקודה צ''כיה','OCTAVIA','5E33BD',2018,'שנהב לבן','פרטי','2026-03-10','car',v_agent);
  INSERT INTO policy_groups(id,client_id,agent_id) VALUES(v_group,v_client,v_agent);
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_klal,'ELZAMI','2026-01-04','2026-12-31',0,0,0,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policies(id,client_id,car_id,company_id,policy_type_parent,policy_type_child,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_pol,v_client,v_car,v_aradi,'THIRD_FULL','FULL','2026-01-04','2026-12-31',3300,1884,966,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,road_service_id,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_tiktak,'ROAD_SERVICE','2026-01-04','2026-12-31',0,0,0,rs_450,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policy_payments(policy_id,payment_type,amount,payment_date,agent_id,notes,source) VALUES
    (v_pol,'cash',3300,'2025-12-31',v_agent,'Imported from Excel - originally cheque','user');

  -- Row 4: סיף אדקידק, CIVIC 2009, THIRD no mandatory, tiktak 160 -> 120 closest
  v_client:=gen_random_uuid(); v_car:=gen_random_uuid(); v_group:=gen_random_uuid(); v_pol:=gen_random_uuid();
  INSERT INTO clients(id,full_name,id_number,phone_number,agent_id,notes) VALUES
    (v_client,'סיף אדקידק','TMP-53-348-68','050-742-6002',v_agent,'Imported from Excel - no ID');
  INSERT INTO cars(id,client_id,car_number,manufacturer_name,model,model_number,year,color,license_type,license_expiry,car_type,agent_id) VALUES
    (v_car,v_client,'5334868','הונדה טורקיה','CIVIC','FD76',2009,'אפור מטל','פרטי','2026-09-05','car',v_agent);
  INSERT INTO policy_groups(id,client_id,agent_id) VALUES(v_group,v_client,v_agent);
  INSERT INTO policies(id,client_id,car_id,company_id,policy_type_parent,policy_type_child,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_pol,v_client,v_car,v_aradi,'THIRD_FULL','THIRD','2026-01-04','2026-12-31',1300,893,247,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,road_service_id,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_tiktak,'ROAD_SERVICE','2026-01-04','2026-12-31',0,0,0,rs_120,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policy_payments(policy_id,payment_type,amount,payment_date,agent_id,notes,source) VALUES
    (v_pol,'cash',1300,'2025-12-31',v_agent,'Imported from Excel - originally cheque','user');

  -- Row 5: עומר אבו פילאת, I30 2009, THIRD no mandatory
  v_client:=gen_random_uuid(); v_car:=gen_random_uuid(); v_group:=gen_random_uuid(); v_pol:=gen_random_uuid();
  INSERT INTO clients(id,full_name,id_number,phone_number,agent_id,notes) VALUES
    (v_client,'עומר אבו פילאת','TMP-62-279-69','050-742-6002',v_agent,'Imported from Excel - no ID');
  INSERT INTO cars(id,client_id,car_number,manufacturer_name,model,model_number,year,color,license_type,license_expiry,car_type,agent_id) VALUES
    (v_car,v_client,'6227969','יונדאי צ''כיה','I30','DB51D',2009,'אפור פלדה','פרטי','2026-10-18','car',v_agent);
  INSERT INTO policy_groups(id,client_id,agent_id) VALUES(v_group,v_client,v_agent);
  INSERT INTO policies(id,client_id,car_id,company_id,policy_type_parent,policy_type_child,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_pol,v_client,v_car,v_aradi,'THIRD_FULL','THIRD','2026-01-04','2026-12-31',1300,893,247,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,road_service_id,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_tiktak,'ROAD_SERVICE','2026-01-04','2026-12-31',0,0,0,rs_120,v_group,v_agent,true,true,0,'2025-12-31');
  INSERT INTO policy_payments(policy_id,payment_type,amount,payment_date,agent_id,notes,source) VALUES
    (v_pol,'cash',1300,'2025-12-31',v_agent,'Imported from Excel - originally cheque','user');

  -- Row 6: חאזם מריש, SUPERB 2012, FULL with mandatory=מנורה, tiktak 280 -> 300 closest, phone 052-866-4604, paydate 08.01.2026
  v_client:=gen_random_uuid(); v_car:=gen_random_uuid(); v_group:=gen_random_uuid(); v_pol:=gen_random_uuid();
  INSERT INTO clients(id,full_name,id_number,phone_number,agent_id,notes) VALUES
    (v_client,'חאזם מריש','TMP-81-967-76','052-866-4604',v_agent,'Imported from Excel - no ID');
  INSERT INTO cars(id,client_id,car_number,manufacturer_name,model,model_number,year,color,license_type,license_expiry,car_type,agent_id) VALUES
    (v_car,v_client,'8196776','סקודה צ''כיה','SUPERB','3T439C',2012,'כסף כחלחל מטלי','פרטי','2027-01-01','car',v_agent);
  INSERT INTO policy_groups(id,client_id,agent_id) VALUES(v_group,v_client,v_agent);
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_menorah,'ELZAMI','2026-01-04','2026-12-31',0,0,0,v_group,v_agent,true,true,0,'2026-01-08');
  INSERT INTO policies(id,client_id,car_id,company_id,policy_type_parent,policy_type_child,start_date,end_date,insurance_price,payed_for_company,profit,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_pol,v_client,v_car,v_aradi,'THIRD_FULL','FULL','2026-01-04','2026-12-31',2800,1884,636,v_group,v_agent,true,true,0,'2026-01-08');
  INSERT INTO policies(client_id,car_id,company_id,policy_type_parent,start_date,end_date,insurance_price,payed_for_company,profit,road_service_id,group_id,agent_id,manual_override,skip_recalc,office_commission,issue_date) VALUES
    (v_client,v_car,v_tiktak,'ROAD_SERVICE','2026-01-04','2026-12-31',0,0,0,rs_300,v_group,v_agent,true,true,0,'2026-01-08');
  INSERT INTO policy_payments(policy_id,payment_type,amount,payment_date,agent_id,notes,source) VALUES
    (v_pol,'cash',2800,'2026-01-08',v_agent,'Imported from Excel - originally cheque','user');
END $$;
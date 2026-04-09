CREATE OR REPLACE FUNCTION public.clear_data_for_import()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted_tables text[];
BEGIN
  -- Detach preserved configuration records from transactional entities (FK-safe)
  -- Companies are preserved, but may optionally reference brokers.
  UPDATE insurance_companies SET broker_id = NULL WHERE broker_id IS NOT NULL;

  -- Fast, FK-safe wipe of transactional tables.
  -- Using TRUNCATE avoids long DELETE runtimes and FK ordering issues.
  TRUNCATE TABLE
    ab_ledger,
    broker_settlement_items,
    broker_settlements,
    company_settlements,
    customer_wallet_transactions,
    payment_images,
    policy_payments,
    outside_cheques,
    invoices,
    policy_reminders,
    policy_renewal_tracking,
    policy_transfers,
    customer_signatures,
    accident_third_parties,
    accident_reports,
    car_accidents,
    sms_logs,
    marketing_sms_recipients,
    marketing_sms_campaigns,
    automated_sms_log,
    notifications,
    media_files,
    expenses,
    import_progress,
    policies,
    policy_groups,
    cars,
    clients,
    brokers
  RESTART IDENTITY;

  v_deleted_tables := ARRAY[
    'ab_ledger',
    'broker_settlement_items',
    'broker_settlements',
    'company_settlements',
    'customer_wallet_transactions',
    'payment_images',
    'policy_payments',
    'outside_cheques',
    'invoices',
    'policy_reminders',
    'policy_renewal_tracking',
    'policy_transfers',
    'customer_signatures',
    'accident_third_parties',
    'accident_reports',
    'car_accidents',
    'sms_logs',
    'marketing_sms_recipients',
    'marketing_sms_campaigns',
    'automated_sms_log',
    'notifications',
    'media_files',
    'expenses',
    'import_progress',
    'policies',
    'policy_groups',
    'cars',
    'clients',
    'brokers'
  ];

  RETURN jsonb_build_object(
    'success', true,
    'method', 'truncate',
    'deleted_tables', v_deleted_tables,
    'preserved', ARRAY[
      'insurance_companies',
      'pricing_rules',
      'branches',
      'profiles',
      'user_roles',
      'announcements',
      'auth_settings',
      'payment_settings',
      'invoice_templates',
      'sms_settings',
      'insurance_categories',
      'road_services',
      'accident_fee_services',
      'company_road_service_prices',
      'company_accident_fee_prices',
      'company_accident_templates',
      'insurance_company_groups'
    ]
  );
END;
$$;
-- Cascade-fix the remaining FKs that referenced clients / cars / policies
-- without an ON DELETE clause (defaulting to NO ACTION = block). When a
-- customer with any of these related rows is hard-deleted, Postgres
-- raises 23503 and the DELETE FROM clients call fails — surface in the
-- UI as the generic "فشل في حذف العميل".
--
-- Decision per FK:
--   * NOT NULL columns whose row is meaningless without the parent
--     (accident reports, customer signatures, marketing/SMS log rows
--     attached to the customer)  →  ON DELETE CASCADE
--   * Nullable cross-reference columns where we'd rather keep the
--     historical row but null out the pointer (renewal intent's
--     new/transferred-from policy, automated SMS log car_id) →
--     ON DELETE SET NULL
--
-- Uses a DO block + introspection so we don't depend on the exact
-- constraint names Postgres auto-assigned (which can drift between
-- environments / re-creations).

DO $$
DECLARE
  rec record;
  fix record;
BEGIN
  FOR fix IN
    SELECT *
    FROM (VALUES
      ('accident_reports',         'policy_id',                   'CASCADE'),
      ('customer_signatures',      'car_id',                      'CASCADE'),
      ('customer_signatures',      'policy_id',                   'CASCADE'),
      ('marketing_sms_recipients', 'client_id',                   'CASCADE'),
      ('automated_sms_log',        'client_id',                   'CASCADE'),
      ('automated_sms_log',        'car_id',                      'SET NULL'),
      ('renewal_intents',          'new_policy_id',               'SET NULL'),
      ('renewal_intents',          'transferred_from_policy_id',  'SET NULL'),
      ('policies',                 'transferred_from_policy_id',  'SET NULL'),
      ('policy_groups',            'car_id',                      'CASCADE'),
      ('policy_transfers',         'new_policy_id',               'SET NULL'),
      ('repair_claims',            'client_id',                   'CASCADE'),
      ('repair_claims',            'policy_id',                   'CASCADE')
    ) AS t(table_name, column_name, on_delete_action)
  LOOP
    -- Find every FK constraint on (table_name, column_name) and rewrite it
    FOR rec IN
      SELECT con.conname,
             cls.relname AS table_name,
             att.attname AS column_name,
             ref_cls.relname AS ref_table,
             ref_att.attname AS ref_column,
             pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con
      JOIN pg_class cls         ON cls.oid = con.conrelid
      JOIN pg_namespace nsp     ON nsp.oid = cls.relnamespace
      JOIN pg_attribute att     ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
      JOIN pg_class ref_cls     ON ref_cls.oid = con.confrelid
      JOIN pg_attribute ref_att ON ref_att.attrelid = con.confrelid AND ref_att.attnum = ANY(con.confkey)
      WHERE con.contype = 'f'
        AND nsp.nspname = 'public'
        AND cls.relname = fix.table_name
        AND att.attname = fix.column_name
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
        rec.table_name, rec.conname
      );

      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s',
        rec.table_name,
        rec.conname,
        rec.column_name,
        rec.ref_table,
        rec.ref_column,
        fix.on_delete_action
      );

      RAISE NOTICE 'Rewrote FK %.% → %.% as ON DELETE %',
        rec.table_name, rec.column_name,
        rec.ref_table, rec.ref_column,
        fix.on_delete_action;
    END LOOP;
  END LOOP;
END$$;

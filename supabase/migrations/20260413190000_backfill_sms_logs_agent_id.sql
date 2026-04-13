-- The previous migration skipped sms_logs because its agent_id column
-- already existed. But the column had never been backfilled — every row
-- still had agent_id IS NULL, so the delete_agent_cascade sweep
-- (DELETE ... WHERE agent_id = X) matched zero rows and the orphaned
-- created_by pins continued to block agent deletion.
--
-- Fix: backfill agent_id from every known path, drop any row we can't
-- map, ensure the column is NOT NULL, and attach an ON DELETE CASCADE
-- FK so future agent deletes propagate at the database level.

DO $$
DECLARE
  v_remaining int;
  v_fk_exists boolean;
  v_fk_is_cascade boolean;
BEGIN
  -- Backfill via branch -> agent
  UPDATE public.sms_logs s
     SET agent_id = b.agent_id
    FROM public.branches b
   WHERE s.branch_id = b.id AND s.agent_id IS NULL;

  -- Backfill via client -> agent
  UPDATE public.sms_logs s
     SET agent_id = c.agent_id
    FROM public.clients c
   WHERE s.client_id = c.id AND s.agent_id IS NULL;

  -- Backfill via policy -> agent
  UPDATE public.sms_logs s
     SET agent_id = p.agent_id
    FROM public.policies p
   WHERE s.policy_id = p.id AND s.agent_id IS NULL;

  -- Backfill via created_by profile -> agent
  UPDATE public.sms_logs s
     SET agent_id = pr.agent_id
    FROM public.profiles pr
   WHERE s.created_by = pr.id AND s.agent_id IS NULL AND pr.agent_id IS NOT NULL;

  -- Drop truly orphaned rows (no branch, client, policy, or creator)
  DELETE FROM public.sms_logs WHERE agent_id IS NULL;

  SELECT count(*) INTO v_remaining FROM public.sms_logs WHERE agent_id IS NULL;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'sms_logs still has % rows with NULL agent_id', v_remaining;
  END IF;

  -- Tighten the column
  ALTER TABLE public.sms_logs ALTER COLUMN agent_id SET NOT NULL;

  -- Check whether an agent_id FK with ON DELETE CASCADE already exists
  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'sms_logs'
        AND kcu.column_name = 'agent_id'
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public'
        AND cl.relname = 'sms_logs'
        AND con.contype = 'f'
        AND con.confdeltype = 'c' -- 'c' = CASCADE
        AND con.conkey = (
          SELECT array_agg(a.attnum ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = cl.oid AND a.attname = 'agent_id'
        )
    )
  INTO v_fk_exists, v_fk_is_cascade;

  IF v_fk_exists AND NOT v_fk_is_cascade THEN
    -- Drop the existing non-cascade FK so we can replace it
    EXECUTE (
      SELECT format('ALTER TABLE public.sms_logs DROP CONSTRAINT %I', con.conname)
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE ns.nspname = 'public'
        AND cl.relname = 'sms_logs'
        AND con.contype = 'f'
        AND con.conkey = (
          SELECT array_agg(a.attnum ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = cl.oid AND a.attname = 'agent_id'
        )
      LIMIT 1
    );
    v_fk_exists := false;
  END IF;

  IF NOT v_fk_exists THEN
    ALTER TABLE public.sms_logs
      ADD CONSTRAINT sms_logs_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;
  END IF;

  CREATE INDEX IF NOT EXISTS idx_sms_logs_agent_id ON public.sms_logs(agent_id);
END $$;

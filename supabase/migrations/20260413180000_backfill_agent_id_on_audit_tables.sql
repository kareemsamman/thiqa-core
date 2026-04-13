-- Schema-level fix for the fragile column-name sweep in delete_agent_cascade.
-- Any public table carrying agent-scoped activity (sms_logs, etc.) should
-- have its own agent_id column + FK + ON DELETE CASCADE, so deleting an
-- agent propagates naturally at the database level.
--
-- Part 1: explicit handling for sms_logs, backfilling through every known
--         path (branch -> agent, client -> agent, policy -> agent, created_by
--         -> profile -> agent) because its created_by is nullable for
--         system-generated rows.
-- Part 2: generic DO block that catches any other public table whose FK to
--         profiles(id) is its only link to an agent, adds agent_id + CASCADE.

-- ─────────── Part 1: sms_logs ─────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sms_logs'
      AND column_name = 'agent_id'
  ) THEN
    RAISE NOTICE 'sms_logs already has agent_id — skipping part 1';
    RETURN;
  END IF;

  ALTER TABLE public.sms_logs ADD COLUMN agent_id uuid;

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

  ALTER TABLE public.sms_logs ALTER COLUMN agent_id SET NOT NULL;
  ALTER TABLE public.sms_logs
    ADD CONSTRAINT sms_logs_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE;
  CREATE INDEX IF NOT EXISTS idx_sms_logs_agent_id ON public.sms_logs(agent_id);
END $$;

-- ─────────── Part 2: generic loop for any other profile-only tables ──────
DO $$
DECLARE
  r RECORD;
  v_fk_name text;
  v_ix_name text;
  v_remaining int;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (kcu.table_name)
           kcu.table_name,
           kcu.column_name
    FROM information_schema.key_column_usage kcu
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'profiles'
      AND ccu.column_name = 'id'
      AND kcu.column_name IN ('created_by', 'user_id')
      AND kcu.table_name NOT IN ('agents', 'profiles', 'agent_users', 'user_roles', 'sms_logs')
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns ic
        WHERE ic.table_schema = 'public'
          AND ic.table_name = kcu.table_name
          AND ic.column_name = 'agent_id'
      )
    ORDER BY kcu.table_name, kcu.column_name
  LOOP
    v_fk_name := r.table_name || '_agent_id_fkey';
    v_ix_name := 'idx_' || r.table_name || '_agent_id';

    RAISE NOTICE 'Backfilling agent_id on %. user column: %', r.table_name, r.column_name;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN agent_id uuid', r.table_name);

    EXECUTE format(
      'UPDATE public.%I t SET agent_id = p.agent_id FROM public.profiles p WHERE t.%I = p.id AND p.agent_id IS NOT NULL',
      r.table_name, r.column_name
    );

    EXECUTE format('DELETE FROM public.%I WHERE agent_id IS NULL', r.table_name);

    EXECUTE format('SELECT count(*) FROM public.%I WHERE agent_id IS NULL', r.table_name)
      INTO v_remaining;
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Backfill left % rows with NULL agent_id on %', v_remaining, r.table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN agent_id SET NOT NULL', r.table_name);

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (agent_id) REFERENCES public.agents(id) ON DELETE CASCADE',
      r.table_name, v_fk_name
    );

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I(agent_id)',
      v_ix_name, r.table_name
    );
  END LOOP;
END $$;

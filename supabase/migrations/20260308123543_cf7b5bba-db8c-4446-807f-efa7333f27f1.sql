-- Create a function that auto-sets agent_id on insert based on the current user
CREATE OR REPLACE FUNCTION public.auto_set_agent_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  -- Only set if agent_id is NULL
  IF NEW.agent_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Look up the user's agent_id
  SELECT au.agent_id INTO v_agent_id
  FROM public.agent_users au
  WHERE au.user_id = auth.uid()
  LIMIT 1;

  IF v_agent_id IS NOT NULL THEN
    NEW.agent_id := v_agent_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Apply this trigger to all tables that have agent_id column
-- Core business tables
DO $$
DECLARE
  tbl text;
  trigger_name text;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'agent_id' AND table_schema = 'public'
    AND table_name NOT IN ('agents', 'agent_users', 'agent_feature_flags', 'agent_subscription_payments')
  LOOP
    trigger_name := 'auto_set_agent_id_' || tbl;
    
    -- Drop if exists
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trigger_name, tbl);
    
    -- Create trigger
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auto_set_agent_id()',
      trigger_name, tbl
    );
    
    RAISE NOTICE 'Created auto_set_agent_id trigger on %', tbl;
  END LOOP;
END;
$$;
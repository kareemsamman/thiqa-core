-- agents.short_code: a human-readable, unique identifier per agent
-- ("THQ-XXXX" with 4 random alphanumeric characters) so Thiqa support
-- can reference an agent in conversations, bug reports, and feature
-- flag overrides without pasting a UUID. The UUID stays the canonical
-- key for joins; short_code is purely a display alias.
--
-- Implementation:
--   1. Add a UNIQUE column. NULL during migration so the backfill can
--      run row by row.
--   2. generate_agent_short_code() picks 4 chars from a confusion-free
--      alphabet (no 0/O, 1/I/L) and re-rolls until it hits an unused
--      code. With ~20M possible codes and ~hundreds of agents the
--      retry rate is effectively zero.
--   3. Backfill in a DO loop so each row sees the codes already
--      committed by earlier iterations (a single UPDATE could collide
--      because each call to generate_agent_short_code() runs against
--      the same pre-update snapshot).
--   4. Trigger so every future INSERT auto-fills.
--   5. Mark NOT NULL once every row has a code.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS short_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.generate_agent_short_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  -- Confusion-free alphabet — strip 0/O, 1/I/L, and lowercase entirely
  -- so a code copy-pasted from a bug report can't be misread.
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
BEGIN
  LOOP
    candidate := 'THQ-';
    FOR i IN 1..4 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    PERFORM 1 FROM public.agents WHERE short_code = candidate;
    IF NOT FOUND THEN
      RETURN candidate;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.agents_set_short_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := public.generate_agent_short_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agents_set_short_code ON public.agents;
CREATE TRIGGER trg_agents_set_short_code
BEFORE INSERT ON public.agents
FOR EACH ROW
EXECUTE FUNCTION public.agents_set_short_code();

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT id FROM public.agents WHERE short_code IS NULL LOOP
    UPDATE public.agents
       SET short_code = public.generate_agent_short_code()
     WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE public.agents
  ALTER COLUMN short_code SET NOT NULL;

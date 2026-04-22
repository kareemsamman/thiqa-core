-- =============================================================================
-- Backfill profiles.permissions for existing worker profiles
-- =============================================================================
-- The phase-4 migration seeded agents.default_employee_permissions so
-- every newly-invited worker inherits the agency template. But the
-- workers who existed at migration time still had permissions = '{}'
-- (meaning they fall through to the agent default at runtime).
--
-- That runtime fallback works, but the editor UX is better when the
-- row has an explicit copy — the admin sees the current state as
-- pre-filled checkboxes instead of blank boxes that silently inherit.
-- Copy the template into each worker's profile now, unless the worker
-- already has a custom override or is an admin.
-- =============================================================================

UPDATE public.profiles p
SET permissions = a.default_employee_permissions
FROM public.agents a
WHERE p.agent_id = a.id
  AND p.permissions = '{}'::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role = 'admin'
  )
  AND a.default_employee_permissions <> '{}'::jsonb;

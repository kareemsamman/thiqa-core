
-- 1) Restrict pbx_extensions SELECT to admins only (passwords are sensitive)
DROP POLICY IF EXISTS agent_data_select ON public.pbx_extensions;

CREATE POLICY pbx_extensions_admin_select
ON public.pbx_extensions
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  AND (is_super_admin(auth.uid()) OR (agent_id IS NOT NULL AND agent_id = get_my_agent_id()))
);

-- 2) Provide a safe listing (no passwords) for non-admin users (e.g., Click2Call dialog)
CREATE OR REPLACE FUNCTION public.list_pbx_extensions_safe()
RETURNS TABLE (
  id uuid,
  extension_number text,
  extension_name text,
  is_default boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, extension_number, extension_name, is_default
  FROM public.pbx_extensions
  WHERE is_super_admin(auth.uid())
     OR (agent_id IS NOT NULL AND agent_id = get_my_agent_id())
  ORDER BY is_default DESC, extension_number ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_pbx_extensions_safe() TO authenticated;

-- 3) Fix import_progress policy to target the 'authenticated' role explicitly
DROP POLICY IF EXISTS "Admins can manage import progress" ON public.import_progress;

CREATE POLICY "Admins can manage import progress"
ON public.import_progress
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

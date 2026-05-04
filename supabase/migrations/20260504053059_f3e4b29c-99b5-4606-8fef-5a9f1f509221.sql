
DROP POLICY IF EXISTS agent_data_select ON public.pbx_extensions;
DROP POLICY IF EXISTS pbx_extensions_admin_select ON public.pbx_extensions;
CREATE POLICY pbx_extensions_admin_select ON public.pbx_extensions
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

DROP POLICY IF EXISTS agent_data_select ON public.payment_settings;
CREATE POLICY payment_settings_admin_select ON public.payment_settings
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

DROP POLICY IF EXISTS agent_data_select ON public.auth_settings;
CREATE POLICY auth_settings_admin_select ON public.auth_settings
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

DROP POLICY IF EXISTS agent_data_select ON public.sms_settings;
CREATE POLICY sms_settings_admin_select ON public.sms_settings
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

DROP POLICY IF EXISTS agent_data_select ON public.xservice_settings;
CREATE POLICY xservice_settings_admin_select ON public.xservice_settings
  FOR SELECT USING (
    is_super_admin(auth.uid())
    OR (
      has_role(auth.uid(), 'admin'::app_role)
      AND agent_id IS NOT NULL
      AND (
        (get_impersonated_agent_id() IS NOT NULL AND agent_id = get_impersonated_agent_id())
        OR (get_impersonated_agent_id() IS NULL AND agent_id = get_my_agent_id())
      )
    )
  );

DROP FUNCTION IF EXISTS public.compute_md5_password() CASCADE;
ALTER TABLE public.pbx_extensions DROP COLUMN IF EXISTS password_plain;

CREATE OR REPLACE FUNCTION public.get_my_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT target_agent_id
       FROM public.impersonation_sessions
      WHERE super_admin_user_id = auth.uid()
        AND public.is_super_admin(auth.uid())),
    (SELECT agent_id
       FROM public.agent_users
      WHERE user_id = auth.uid()
      LIMIT 1)
  );
$function$;

ALTER PUBLICATION supabase_realtime DROP TABLE public.agents;

CREATE OR REPLACE FUNCTION public.get_payment_provider_enabled(p_provider text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT is_enabled
       FROM public.payment_settings
      WHERE agent_id = public.get_my_agent_id()
        AND provider = p_provider
      LIMIT 1),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_payment_provider_enabled(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_sms_cancellation_template()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cancellation_sms_template
    FROM public.sms_settings
   WHERE agent_id = public.get_my_agent_id()
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_sms_cancellation_template() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_company_contact_info()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'company_phone_links', company_phone_links,
    'company_location', company_location
  )
    FROM public.sms_settings
   WHERE agent_id = public.get_my_agent_id()
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_company_contact_info() TO authenticated;

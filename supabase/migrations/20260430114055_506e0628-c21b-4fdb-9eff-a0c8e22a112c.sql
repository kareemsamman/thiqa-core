
-- 1) ANNOUNCEMENTS: remove permissive agent-scoped mutation policies.
--    Mutations remain restricted to super admin via existing policies.
DROP POLICY IF EXISTS "agent_data_insert" ON public.announcements;
DROP POLICY IF EXISTS "agent_data_update" ON public.announcements;
DROP POLICY IF EXISTS "agent_data_delete" ON public.announcements;

-- 2) USER_ROLES: require admin role to insert/update/delete role assignments.
DROP POLICY IF EXISTS "agent_data_insert" ON public.user_roles;
DROP POLICY IF EXISTS "agent_data_update" ON public.user_roles;
DROP POLICY IF EXISTS "agent_data_delete" ON public.user_roles;

CREATE POLICY "Admins can assign roles within their agent"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

CREATE POLICY "Admins can update roles within their agent"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

CREATE POLICY "Admins can delete roles within their agent"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

-- 3) NOTIFICATIONS: non-admins should only see/modify their own notifications.
DROP POLICY IF EXISTS "agent_data_select" ON public.notifications;
DROP POLICY IF EXISTS "agent_data_update" ON public.notifications;
DROP POLICY IF EXISTS "agent_data_delete" ON public.notifications;

CREATE POLICY "Users see own notifications, admins see agent-wide"
ON public.notifications
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

CREATE POLICY "Users update own notifications, admins update agent-wide"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

CREATE POLICY "Users delete own notifications, admins delete agent-wide"
ON public.notifications
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_super_admin(auth.uid())
  OR (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND agent_id IS NOT NULL
    AND agent_id = public.get_my_agent_id()
  )
);

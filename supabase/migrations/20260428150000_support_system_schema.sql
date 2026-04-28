-- Support ticket system — Stage 1: schema, RLS, storage.
--
-- Four tables form a one-shot ticket flow that turns into a chat:
--   support_categories — admin-managed taxonomy. Self-referencing
--     (parent_id NULL = top-level, set = subcategory). Two levels are
--     enough; we don't need arbitrary nesting.
--   support_tickets — one per "issue". Carries agent_id, category +
--     subcategory, subject, status, and a sequential ticket_number
--     (TKT-XXXXX) so admin and agent can both reference it in
--     conversation without juggling UUIDs.
--   support_messages — the chat thread. Each ticket starts with
--     exactly one message (the agent's initial complaint), and each
--     reply (agent or admin) adds another row. is_admin_reply is
--     denormalized at insert time so the UI can color/align messages
--     without re-checking roles on every render.
--   support_attachments — attached to a specific message. The actual
--     bytes live in the support-attachments storage bucket; this
--     table just records URL + filename + size + mime_type.
--
-- RLS philosophy:
--   - Categories are world-readable (every agent's picker needs them)
--     but only super-admin writes.
--   - Tickets visible to: creator + any agent admin in the same agent
--     + super-admin. Workers see only tickets they themselves opened.
--     The agent admin gets a free pass because they're meant to be
--     able to oversee everything their team submits.
--   - Status changes are super-admin only — agents can't mark their
--     own tickets done.
--   - Storage: bucket is private; client uploads with their own JWT
--     and gets signed URLs to display.

-- ─────────────────────────────────────────────────────────────────
-- 1. Categories
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.support_categories(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  name_en text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_categories_parent
  ON public.support_categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_support_categories_active_sort
  ON public.support_categories (is_active, sort_order);

ALTER TABLE public.support_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_categories_select_all" ON public.support_categories;
CREATE POLICY "support_categories_select_all"
  ON public.support_categories FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "support_categories_super_admin_all" ON public.support_categories;
CREATE POLICY "support_categories_super_admin_all"
  ON public.support_categories FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- Seed a starter taxonomy so the page is usable on day one. Admin
-- can edit/extend from the categories CRUD page later.
INSERT INTO public.support_categories (id, name_ar, name_en, sort_order, parent_id) VALUES
  ('11111111-1111-1111-1111-111111111101', 'مشكلة / Bug',         'Bug',           10, NULL),
  ('11111111-1111-1111-1111-111111111102', 'استفسار',              'Question',      20, NULL),
  ('11111111-1111-1111-1111-111111111103', 'طلب ميزة',             'Feature request', 30, NULL),
  ('11111111-1111-1111-1111-111111111104', 'فاتورة / اشتراك',      'Billing',       40, NULL),
  ('11111111-1111-1111-1111-111111111105', 'أخرى',                 'Other',         99, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.support_categories (id, name_ar, name_en, sort_order, parent_id) VALUES
  ('22222222-2222-2222-2222-222222222101', 'العملاء',     'Clients',  10, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222102', 'المعاملات',   'Policies', 20, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222103', 'المالية',     'Finance',  30, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222104', 'الرسائل',     'SMS',      40, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222105', 'تسجيل الدخول','Login',    50, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222106', 'الأداء',      'Performance', 60, '11111111-1111-1111-1111-111111111101'),
  ('22222222-2222-2222-2222-222222222199', 'أخرى',        'Other',    99, '11111111-1111-1111-1111-111111111101')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────
-- 2. Ticket-number sequence + tickets table
-- ─────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.support_ticket_number_seq
  START WITH 1000
  INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE
    DEFAULT 'TKT-' || lpad(nextval('public.support_ticket_number_seq')::text, 5, '0'),
  agent_id uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.support_categories(id),
  subcategory_id uuid REFERENCES public.support_categories(id),
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_agent_status
  ON public.support_tickets (agent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_creator
  ON public.support_tickets (created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_global
  ON public.support_tickets (status, created_at DESC);

-- Bump updated_at + closed_at on status changes.
CREATE OR REPLACE FUNCTION public.support_tickets_touch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IN ('done', 'cancelled') AND OLD.status NOT IN ('done', 'cancelled') THEN
    NEW.closed_at := now();
  ELSIF NEW.status NOT IN ('done', 'cancelled') AND OLD.status IN ('done', 'cancelled') THEN
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_touch ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_touch
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.support_tickets_touch();

-- Visibility helper. Inlined into RLS policies on every related table
-- so they stay in sync. Logic:
--   - super-admin: yes, always.
--   - creator: yes, their own ticket.
--   - agent admin (user_roles.role='admin' on the same agent_id): yes,
--     so they can oversee their team's submissions.
--   - everyone else: no.
CREATE OR REPLACE FUNCTION public.can_view_support_ticket(
  _ticket_agent_id uuid,
  _ticket_creator uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.is_super_admin(auth.uid()) THEN true
    WHEN _ticket_creator = auth.uid() THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'admin'::public.app_role
        AND ur.agent_id = _ticket_agent_id
    )
  END
$$;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_select" ON public.support_tickets;
CREATE POLICY "support_tickets_select"
  ON public.support_tickets FOR SELECT
  TO authenticated
  USING (public.can_view_support_ticket(agent_id, created_by_user_id));

-- INSERT: caller writes their own row, agent_id must match their
-- profile's agent_id so a worker can't open a ticket "as another
-- agent". Super-admins can open on behalf of an agent if needed.
DROP POLICY IF EXISTS "support_tickets_insert" ON public.support_tickets;
CREATE POLICY "support_tickets_insert"
  ON public.support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND (
      public.is_super_admin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.agent_id = support_tickets.agent_id
      )
    )
  );

-- UPDATE: super-admin only. Status changes belong to support staff,
-- not the requester. Agents can re-open conversation by sending a new
-- message instead.
DROP POLICY IF EXISTS "support_tickets_update_super_admin" ON public.support_tickets;
CREATE POLICY "support_tickets_update_super_admin"
  ON public.support_tickets FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────
-- 3. Messages
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  body text NOT NULL,
  -- Denormalized at insert via trigger so the UI can render admin
  -- replies on the left / agent messages on the right without an
  -- N+1 role lookup per message render.
  is_admin_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON public.support_messages (ticket_id, created_at);

CREATE OR REPLACE FUNCTION public.support_messages_set_role()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.is_admin_reply := public.is_super_admin(NEW.author_user_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_set_role ON public.support_messages;
CREATE TRIGGER trg_support_messages_set_role
BEFORE INSERT ON public.support_messages
FOR EACH ROW
EXECUTE FUNCTION public.support_messages_set_role();

-- Bump the parent ticket's updated_at whenever a new message lands so
-- "recently active" sorting in the inbox just works.
CREATE OR REPLACE FUNCTION public.support_messages_touch_ticket()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.support_tickets
     SET updated_at = now()
   WHERE id = NEW.ticket_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_messages_touch_ticket ON public.support_messages;
CREATE TRIGGER trg_support_messages_touch_ticket
AFTER INSERT ON public.support_messages
FOR EACH ROW
EXECUTE FUNCTION public.support_messages_touch_ticket();

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_messages_select" ON public.support_messages;
CREATE POLICY "support_messages_select"
  ON public.support_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

DROP POLICY IF EXISTS "support_messages_insert" ON public.support_messages;
CREATE POLICY "support_messages_insert"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 4. Attachments
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  file_path text NOT NULL,         -- Path inside the support-attachments storage bucket
  file_name text NOT NULL,         -- Original filename, for display
  file_size bigint,                -- Bytes
  mime_type text,                  -- Content-Type for "is this a video / image" UI branching
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_message
  ON public.support_attachments (message_id);

ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_attachments_select" ON public.support_attachments;
CREATE POLICY "support_attachments_select"
  ON public.support_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.support_messages m
      JOIN public.support_tickets t ON t.id = m.ticket_id
      WHERE m.id = support_attachments.message_id
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

DROP POLICY IF EXISTS "support_attachments_insert" ON public.support_attachments;
CREATE POLICY "support_attachments_insert"
  ON public.support_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.support_messages m
      JOIN public.support_tickets t ON t.id = m.ticket_id
      WHERE m.id = support_attachments.message_id
        AND m.author_user_id = auth.uid()
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────
-- 5. Storage bucket for attachments
-- ─────────────────────────────────────────────────────────────────
-- Private bucket; client gets signed URLs for display. Path layout:
--   {ticket_id}/{message_id}/{filename}
-- so the storage RLS check can extract ticket_id from the path and
-- defer to can_view_support_ticket.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-attachments',
  'support-attachments',
  false,
  52428800,  -- 50 MB ceiling per file (covers typical phone-shot videos)
  ARRAY[
    'image/png','image/jpeg','image/webp','image/gif','image/heic','image/heif',
    'video/mp4','video/quicktime','video/webm','video/x-matroska',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS — extract the ticket_id from the path's first segment
-- and delegate to the same visibility check as the table policies.
DROP POLICY IF EXISTS "support_attachments_storage_select" ON storage.objects;
CREATE POLICY "support_attachments_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = (storage.foldername(name))[1]::uuid
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

DROP POLICY IF EXISTS "support_attachments_storage_insert" ON storage.objects;
CREATE POLICY "support_attachments_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = (storage.foldername(name))[1]::uuid
        AND public.can_view_support_ticket(t.agent_id, t.created_by_user_id)
    )
  );

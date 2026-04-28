-- Support ticket follow-ups:
--   1. Seed smtp_from_email so the support-notify edge function can
--      send From a different address than the support inbox. Without
--      this, From == To == support@getthiqa.com and Gmail/Outlook
--      collapse the message into the "Note to self" folder.
--   2. Allow super-admin to hard-delete a ticket (and let cascading
--      FKs take messages + attachments with it). Storage objects are
--      cleaned up from the client before the row delete.

-- ── 1. SMTP "from" address ─────────────────────────────────────────
INSERT INTO public.thiqa_platform_settings (setting_key, setting_value)
VALUES ('smtp_from_email', 'no-reply@getthiqa.com')
ON CONFLICT (setting_key) DO NOTHING;

-- ── 2. DELETE policies ────────────────────────────────────────────
DROP POLICY IF EXISTS "support_tickets_delete_super_admin" ON public.support_tickets;
CREATE POLICY "support_tickets_delete_super_admin"
  ON public.support_tickets FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Storage objects don't cascade with the ticket row — the client wipes
-- them first, but it needs an RLS policy to do so.
DROP POLICY IF EXISTS "support_attachments_storage_delete" ON storage.objects;
CREATE POLICY "support_attachments_storage_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND public.is_super_admin(auth.uid())
  );

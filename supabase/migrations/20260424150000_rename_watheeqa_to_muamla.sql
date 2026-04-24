-- Product-wide terminology change: وثيقة → معاملة.
--
-- Surfaces affected by this migration:
--   1. notify_on_policy_created trigger function — was writing
--      "وثيقة جديدة" notifications, now writes "معاملة جديدة".
--   2. Existing policy notifications are rewritten in place.
--   3. SMS template defaults on sms_settings (invoice / renewal
--      reminders / cancellation / payment request) — existing rows get
--      the word-swap applied and the column DEFAULT is refreshed so
--      new agents inherit the updated wording.

-- 1. Notification trigger
CREATE OR REPLACE FUNCTION public.notify_on_policy_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  JOIN public.agent_users au ON au.user_id = p.id
  WHERE p.status = 'active'
    AND au.agent_id = NEW.agent_id
    AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);

  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, agent_id)
    SELECT
      unnest(v_admin_users),
      'policy',
      'معاملة جديدة',
      'تم إنشاء معاملة جديدة للعميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/clients?open=' || NEW.client_id::text,
      'policy',
      NEW.id,
      NEW.agent_id;
  END IF;

  RETURN NEW;
END;
$$;


-- 2. Rewrite already-stored policy notifications
UPDATE public.notifications
   SET title   = REPLACE(title,   'وثيقة', 'معاملة'),
       message = REPLACE(message, 'وثيقة', 'معاملة')
 WHERE type = 'policy'
   AND (title LIKE '%وثيقة%' OR message LIKE '%وثيقة%');


-- 3. sms_settings: swap word on every row, then refresh column DEFAULTs
UPDATE public.sms_settings
   SET invoice_sms_template      = REPLACE(invoice_sms_template,      'وثيقة', 'معاملة'),
       reminder_1month_template  = REPLACE(reminder_1month_template,  'وثيقة', 'معاملة'),
       reminder_1week_template   = REPLACE(reminder_1week_template,   'وثيقة', 'معاملة'),
       payment_request_template  = REPLACE(payment_request_template,  'وثيقة', 'معاملة'),
       cancellation_sms_template = REPLACE(cancellation_sms_template, 'وثيقة', 'معاملة')
 WHERE invoice_sms_template      LIKE '%وثيقة%'
    OR reminder_1month_template  LIKE '%وثيقة%'
    OR reminder_1week_template   LIKE '%وثيقة%'
    OR payment_request_template  LIKE '%وثيقة%'
    OR cancellation_sms_template LIKE '%وثيقة%';

UPDATE public.sms_settings
   SET reminder_1month_template = REPLACE(reminder_1month_template, 'الوثيقة', 'المعاملة'),
       reminder_1week_template  = REPLACE(reminder_1week_template,  'الوثيقة', 'المعاملة')
 WHERE reminder_1month_template LIKE '%الوثيقة%'
    OR reminder_1week_template  LIKE '%الوثيقة%';


ALTER TABLE public.sms_settings
  ALTER COLUMN invoice_sms_template
    SET DEFAULT 'مرحباً {{client_name}}، تم إصدار فواتير معاملة التأمين رقم {{policy_number}}. فاتورة AB: {{ab_invoice_url}} فاتورة شركة التأمين: {{insurance_invoice_url}}';

ALTER TABLE public.sms_settings
  ALTER COLUMN reminder_1month_template
    SET DEFAULT 'مرحباً {{client_name}}، تنتهي معاملة التأمين رقم {{policy_number}} خلال شهر. المبلغ المتبقي: {{remaining_amount}} شيكل. يرجى التواصل معنا لتجديد المعاملة.';

ALTER TABLE public.sms_settings
  ALTER COLUMN reminder_1week_template
    SET DEFAULT 'مرحباً {{client_name}}، تنتهي معاملة التأمين رقم {{policy_number}} خلال أسبوع. المبلغ المتبقي: {{remaining_amount}} شيكل. يرجى التواصل معنا قبل انتهاء المعاملة.';

ALTER TABLE public.sms_settings
  ALTER COLUMN payment_request_template
    SET DEFAULT 'مرحباً {{client_name}}، لديك مبلغ متبقي {{remaining_amount}} شيكل على معاملة التأمين رقم {{policy_number}}. يرجى التواصل معنا لتسوية المبلغ.';

ALTER TABLE public.sms_settings
  ALTER COLUMN cancellation_sms_template
    SET DEFAULT 'مرحباً {{client_name}}، تم إلغاء معاملة التأمين رقم {{policy_number}}. {{refund_message}}للاستفسار يرجى التواصل معنا.';

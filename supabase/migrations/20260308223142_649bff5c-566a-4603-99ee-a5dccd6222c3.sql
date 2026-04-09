
-- Fix notification isolation: add agent_id filtering to all notification triggers

-- 1. notify_on_payment_received
CREATE OR REPLACE FUNCTION public.notify_on_payment_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client_name TEXT;
  v_client_id UUID;
  v_policy_type_parent TEXT;
  v_admin_users UUID[];
  v_metadata JSONB;
  v_type_label TEXT;
  v_type_labels TEXT[];
BEGIN
  SELECT c.full_name, c.id, pol.policy_type_parent
  INTO v_client_name, v_client_id, v_policy_type_parent
  FROM public.policies pol
  JOIN public.clients c ON c.id = pol.client_id
  WHERE pol.id = NEW.policy_id;

  IF NEW.locked = true AND NEW.source = 'system' THEN
    v_type_label := 'settlement';
    v_type_labels := ARRAY['تسوية شركة'];
    IF v_policy_type_parent = 'ELZAMI' THEN
      v_type_labels := ARRAY['إلزامي – دفعة تلقائية'];
    END IF;
  ELSE
    v_type_label := 'premium';
    v_type_labels := ARRAY['قسط'];
  END IF;

  v_metadata := jsonb_build_object(
    'payment', jsonb_build_object(
      'payment_id', NEW.id,
      'policy_id', NEW.policy_id,
      'client_id', v_client_id,
      'client_name', COALESCE(v_client_name, 'غير معروف'),
      'amount', NEW.amount,
      'currency', 'ILS',
      'method', COALESCE(NEW.payment_type, 'cash'),
      'type', v_type_label,
      'type_labels', v_type_labels,
      'reference', NEW.cheque_number,
      'notes', NEW.notes,
      'cheque', CASE
        WHEN NEW.payment_type = 'cheque' THEN jsonb_build_object(
          'number', NEW.cheque_number,
          'due_date', COALESCE(NEW.cheque_date, NEW.payment_date)
        )
        ELSE NULL
      END,
      'installment', NULL
    ),
    'payment_method', COALESCE(NEW.payment_type, 'cash'),
    'amount', NEW.amount,
    'client_name', COALESCE(v_client_name, 'غير معروف'),
    'payment_id', NEW.id,
    'reference', NEW.cheque_number
  );

  SELECT ARRAY_AGG(p.id) INTO v_admin_users
  FROM public.profiles p
  JOIN public.agent_users au ON au.user_id = p.id
  WHERE p.status = 'active'
    AND au.agent_id = NEW.agent_id
    AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);

  IF v_admin_users IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, metadata, agent_id)
    SELECT
      unnest(v_admin_users),
      'payment',
      CASE
        WHEN NEW.locked = true AND v_policy_type_parent = 'ELZAMI' THEN 'دفعة إلزامي تلقائية'
        ELSE 'دفعة جديدة'
      END,
      'تم استلام دفعة بمبلغ ₪' || NEW.amount::text || ' من العميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/policies',
      'policy_payment',
      NEW.id,
      v_metadata,
      NEW.agent_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. notify_on_policy_created
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
      'وثيقة جديدة',
      'تم إنشاء وثيقة جديدة للعميل ' || COALESCE(v_client_name, 'غير معروف'),
      '/clients?open=' || NEW.client_id::text,
      'policy',
      NEW.id,
      NEW.agent_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. notify_on_client_created
CREATE OR REPLACE FUNCTION public.notify_on_client_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_users UUID[];
BEGIN
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
      'client',
      'عميل جديد',
      'تم إضافة عميل جديد: ' || COALESCE(NEW.full_name, 'غير معروف'),
      '/clients',
      'client',
      NEW.id,
      NEW.agent_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. notify_on_customer_signature (UPDATE trigger)
CREATE OR REPLACE FUNCTION public.notify_on_customer_signature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  IF NEW.signature_image_url IS NOT NULL AND NEW.signature_image_url <> '' AND (OLD.signature_image_url IS NULL OR OLD.signature_image_url = '') THEN
    SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

    SELECT ARRAY_AGG(p.id) INTO v_admin_users
    FROM public.profiles p
    JOIN public.agent_users au ON au.user_id = p.id
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.status = 'active'
      AND au.agent_id = NEW.agent_id
      AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);

    IF v_admin_users IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, agent_id)
      SELECT
        unnest(v_admin_users),
        'signature',
        'توقيع عميل جديد',
        'قام العميل ' || COALESCE(v_client_name, 'غير معروف') || ' بالتوقيع',
        '/clients',
        'customer_signature',
        NEW.id,
        NEW.agent_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. notify_on_customer_signature_insert (INSERT trigger)
CREATE OR REPLACE FUNCTION public.notify_on_customer_signature_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  IF NEW.signature_image_url IS NOT NULL AND NEW.signature_image_url <> '' THEN
    SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

    SELECT ARRAY_AGG(p.id) INTO v_admin_users
    FROM public.profiles p
    JOIN public.agent_users au ON au.user_id = p.id
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.status = 'active'
      AND au.agent_id = NEW.agent_id
      AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);

    IF v_admin_users IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id, agent_id)
      SELECT
        unnest(v_admin_users),
        'signature',
        'توقيع عميل جديد',
        'قام العميل ' || COALESCE(v_client_name, 'غير معروف') || ' بالتوقيع',
        '/clients',
        'customer_signature',
        NEW.id,
        NEW.agent_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

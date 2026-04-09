-- Create notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  entity_type TEXT,
  entity_id UUID,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view their own notifications"
ON public.notifications
FOR SELECT
USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update their own notifications"
ON public.notifications
FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own notifications
CREATE POLICY "Users can delete their own notifications"
ON public.notifications
FOR DELETE
USING (auth.uid() = user_id);

-- Service role/admins can insert notifications for users
CREATE POLICY "Service can insert notifications"
ON public.notifications
FOR INSERT
WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX idx_notifications_is_read ON public.notifications(is_read);

-- Create function to add notification when customer signs
CREATE OR REPLACE FUNCTION public.notify_on_customer_signature()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  -- Only trigger when signature_image_url is updated (customer signed)
  IF NEW.signature_image_url IS NOT NULL AND NEW.signature_image_url <> '' AND (OLD.signature_image_url IS NULL OR OLD.signature_image_url = '') THEN
    -- Get client name
    SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
    
    -- Get all active admin users in the same branch
    SELECT ARRAY_AGG(p.id) INTO v_admin_users
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.status = 'active'
    AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
    
    -- Insert notification for each admin
    IF v_admin_users IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
      SELECT 
        unnest(v_admin_users),
        'signature',
        'توقيع عميل جديد',
        'قام العميل ' || COALESCE(v_client_name, 'غير معروف') || ' بالتوقيع',
        '/clients',
        'customer_signature',
        NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for customer signatures
CREATE TRIGGER on_customer_signature_update
  AFTER UPDATE ON public.customer_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_customer_signature();

-- Also trigger on insert if signature exists
CREATE OR REPLACE FUNCTION public.notify_on_customer_signature_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name TEXT;
  v_admin_users UUID[];
BEGIN
  -- Only trigger when signature_image_url exists
  IF NEW.signature_image_url IS NOT NULL AND NEW.signature_image_url <> '' THEN
    -- Get client name
    SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;
    
    -- Get all active admin users in the same branch
    SELECT ARRAY_AGG(p.id) INTO v_admin_users
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id
    WHERE p.status = 'active'
    AND (p.branch_id IS NULL OR p.branch_id = NEW.branch_id);
    
    -- Insert notification for each admin
    IF v_admin_users IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, link, entity_type, entity_id)
      SELECT 
        unnest(v_admin_users),
        'signature',
        'توقيع عميل جديد',
        'قام العميل ' || COALESCE(v_client_name, 'غير معروف') || ' بالتوقيع',
        '/clients',
        'customer_signature',
        NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_customer_signature_insert
  AFTER INSERT ON public.customer_signatures
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_customer_signature_insert();
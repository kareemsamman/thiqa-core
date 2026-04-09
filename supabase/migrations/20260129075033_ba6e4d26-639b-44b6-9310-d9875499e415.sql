-- Add metadata JSONB column to notifications for storing payment info, etc.
ALTER TABLE public.notifications 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Add last_seen_notifications_at to profiles for tracking "new since last visit"
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_seen_notifications_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Enable realtime for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Add index for faster queries on user_id + created_at
CREATE INDEX IF NOT EXISTS idx_notifications_user_created 
ON public.notifications(user_id, created_at DESC);

-- Add index for unread notifications lookup
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread 
ON public.notifications(user_id, is_read) 
WHERE is_read = false;

COMMENT ON COLUMN public.notifications.metadata IS 'Additional data for notifications (e.g., payment_method, amount, client_name for payment notifications)';
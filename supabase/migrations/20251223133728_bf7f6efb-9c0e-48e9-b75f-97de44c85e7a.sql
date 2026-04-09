-- Create SMS log type enum
CREATE TYPE public.sms_type AS ENUM (
  'invoice',
  'signature',
  'reminder_1month',
  'reminder_1week',
  'manual',
  'payment_request'
);

-- Create SMS logs table to track all sent messages
CREATE TABLE public.sms_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id),
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  policy_id UUID REFERENCES public.policies(id) ON DELETE SET NULL,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  sms_type public.sms_type NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, failed
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id)
);

-- Enable RLS
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Branch users can view sms logs"
  ON public.sms_logs
  FOR SELECT
  USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can create sms logs"
  ON public.sms_logs
  FOR INSERT
  WITH CHECK (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Create policy reminder tracking table
CREATE TABLE public.policy_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL, -- '1month', '1week'
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sms_log_id UUID REFERENCES public.sms_logs(id),
  UNIQUE(policy_id, reminder_type)
);

-- Enable RLS
ALTER TABLE public.policy_reminders ENABLE ROW LEVEL SECURITY;

-- RLS policies for policy_reminders
CREATE POLICY "Branch users can view policy reminders"
  ON public.policy_reminders
  FOR SELECT
  USING (
    is_active_user(auth.uid()) AND 
    EXISTS (
      SELECT 1 FROM public.policies p 
      WHERE p.id = policy_id 
      AND can_access_branch(auth.uid(), p.branch_id)
    )
  );

CREATE POLICY "Service can insert policy reminders"
  ON public.policy_reminders
  FOR INSERT
  WITH CHECK (true);

-- Add reminder templates to sms_settings
ALTER TABLE public.sms_settings 
  ADD COLUMN IF NOT EXISTS reminder_1month_template TEXT DEFAULT 'مرحباً {{client_name}}، تنتهي وثيقة التأمين رقم {{policy_number}} خلال شهر. المبلغ المتبقي: {{remaining_amount}} شيكل. يرجى التواصل معنا لتجديد الوثيقة.',
  ADD COLUMN IF NOT EXISTS reminder_1week_template TEXT DEFAULT 'مرحباً {{client_name}}، تنتهي وثيقة التأمين رقم {{policy_number}} خلال أسبوع. المبلغ المتبقي: {{remaining_amount}} شيكل. يرجى التواصل معنا قبل انتهاء الوثيقة.',
  ADD COLUMN IF NOT EXISTS payment_request_template TEXT DEFAULT 'مرحباً {{client_name}}، لديك مبلغ متبقي {{remaining_amount}} شيكل على وثيقة التأمين رقم {{policy_number}}. يرجى التواصل معنا لتسوية المبلغ.',
  ADD COLUMN IF NOT EXISTS enable_auto_reminders BOOLEAN DEFAULT false;

-- Create indexes for performance
CREATE INDEX idx_sms_logs_client_id ON public.sms_logs(client_id);
CREATE INDEX idx_sms_logs_policy_id ON public.sms_logs(policy_id);
CREATE INDEX idx_sms_logs_sms_type ON public.sms_logs(sms_type);
CREATE INDEX idx_sms_logs_created_at ON public.sms_logs(created_at DESC);
CREATE INDEX idx_policy_reminders_policy_id ON public.policy_reminders(policy_id);

-- Enable realtime for sms_logs
ALTER PUBLICATION supabase_realtime ADD TABLE public.sms_logs;
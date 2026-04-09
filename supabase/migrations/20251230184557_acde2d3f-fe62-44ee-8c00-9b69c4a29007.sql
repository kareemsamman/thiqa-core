-- Add cancellation fields to policies table
ALTER TABLE public.policies 
ADD COLUMN IF NOT EXISTS cancellation_note TEXT,
ADD COLUMN IF NOT EXISTS cancellation_date DATE,
ADD COLUMN IF NOT EXISTS cancelled_by_admin_id UUID REFERENCES public.profiles(id);

-- Create customer wallet transactions table for refunds
CREATE TABLE public.customer_wallet_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_id UUID REFERENCES public.policies(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL DEFAULT 'refund', -- 'refund', 'credit', 'debit'
  amount NUMERIC NOT NULL,
  description TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by_admin_id UUID REFERENCES public.profiles(id),
  branch_id UUID REFERENCES public.branches(id)
);

-- Enable RLS on customer_wallet_transactions
ALTER TABLE public.customer_wallet_transactions ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_wallet_transactions
CREATE POLICY "Branch users can view wallet transactions" 
ON public.customer_wallet_transactions 
FOR SELECT 
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

CREATE POLICY "Branch users can manage wallet transactions" 
ON public.customer_wallet_transactions 
FOR ALL 
USING (is_active_user(auth.uid()) AND can_access_branch(auth.uid(), branch_id));

-- Add cancellation SMS template to sms_settings
ALTER TABLE public.sms_settings 
ADD COLUMN IF NOT EXISTS cancellation_sms_template TEXT DEFAULT 'مرحباً {{client_name}}، تم إلغاء وثيقة التأمين رقم {{policy_number}}. {{refund_message}}للاستفسار يرجى التواصل معنا.';

-- Create index for faster wallet lookups by client
CREATE INDEX IF NOT EXISTS idx_customer_wallet_client ON public.customer_wallet_transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_policy ON public.customer_wallet_transactions(policy_id);
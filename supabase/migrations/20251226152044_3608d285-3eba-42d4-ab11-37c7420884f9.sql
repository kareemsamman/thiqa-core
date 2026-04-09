-- Create payment_images table for storing multiple images per payment
CREATE TABLE public.payment_images (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.policy_payments(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  image_type TEXT NOT NULL DEFAULT 'front', -- 'front', 'back', 'receipt'
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_payment_images_payment_id ON public.payment_images(payment_id);

-- Enable RLS
ALTER TABLE public.payment_images ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Branch users can view payment images" 
ON public.payment_images 
FOR SELECT 
USING (
  is_active_user(auth.uid()) AND 
  EXISTS (
    SELECT 1 FROM policy_payments pp 
    WHERE pp.id = payment_images.payment_id 
    AND can_access_branch(auth.uid(), pp.branch_id)
  )
);

CREATE POLICY "Branch users can manage payment images" 
ON public.payment_images 
FOR ALL 
USING (
  is_active_user(auth.uid()) AND 
  EXISTS (
    SELECT 1 FROM policy_payments pp 
    WHERE pp.id = payment_images.payment_id 
    AND can_access_branch(auth.uid(), pp.branch_id)
  )
);
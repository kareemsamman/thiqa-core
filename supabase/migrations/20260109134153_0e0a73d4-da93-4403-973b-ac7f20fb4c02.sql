-- Create expenses table for tracking AB operational costs
CREATE TABLE public.expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id),
  category TEXT NOT NULL, -- 'rent', 'salaries', 'food', 'utilities', 'other'
  description TEXT,
  amount NUMERIC NOT NULL,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by_admin_id UUID REFERENCES public.profiles(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view expenses"
ON public.expenses FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert expenses"
ON public.expenses FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update expenses"
ON public.expenses FOR UPDATE
TO authenticated
USING (true);

CREATE POLICY "Authenticated users can delete expenses"
ON public.expenses FOR DELETE
TO authenticated
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
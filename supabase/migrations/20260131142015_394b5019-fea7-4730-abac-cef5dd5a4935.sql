-- Add RLS policies for workers on leads table
CREATE POLICY "Workers can view all leads" ON public.leads
  FOR SELECT USING (public.has_role(auth.uid(), 'worker'));

CREATE POLICY "Workers can update leads" ON public.leads
  FOR UPDATE USING (public.has_role(auth.uid(), 'worker'));

-- Add DELETE policies for both admins and workers
CREATE POLICY "Admins can delete leads" ON public.leads
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Workers can delete leads" ON public.leads
  FOR DELETE USING (public.has_role(auth.uid(), 'worker'));
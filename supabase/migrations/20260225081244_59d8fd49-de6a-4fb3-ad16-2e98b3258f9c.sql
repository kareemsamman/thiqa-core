
-- Allow all authenticated users to manage repair claims
CREATE POLICY "Authenticated users can manage repair claims"
ON public.repair_claims
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow all authenticated users to manage repair claim notes
CREATE POLICY "Authenticated users can manage repair claim notes"
ON public.repair_claim_notes
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Allow all authenticated users to manage repair claim reminders
CREATE POLICY "Authenticated users can manage repair claim reminders"
ON public.repair_claim_reminders
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);


-- Security: otp_codes has RLS enabled but had no policies.
-- These records contain sensitive OTP hashes/identifiers and should not be accessible from the client.
CREATE POLICY "Deny all access to otp codes"
ON public.otp_codes
FOR ALL
USING (false)
WITH CHECK (false);

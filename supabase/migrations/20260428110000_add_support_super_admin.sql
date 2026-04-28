-- =============================================================================
-- Pre-grant super admin to support@getthiqa.com
-- =============================================================================
-- useAuth.fetchUserProfile checks thiqa_super_admins by lowercased
-- email immediately after auth, so any user signing in with this
-- address will be flagged as super admin and routed to /thiqa.
-- The auth.users row itself is created separately via Supabase
-- Auth (dashboard or signup form) — this migration only seeds the
-- entitlement so the moment that auth user logs in, they're in.
-- ON CONFLICT DO NOTHING keeps the migration idempotent.
-- =============================================================================

INSERT INTO public.thiqa_super_admins (email, name)
VALUES ('support@getthiqa.com', 'Thiqa Support')
ON CONFLICT (email) DO NOTHING;

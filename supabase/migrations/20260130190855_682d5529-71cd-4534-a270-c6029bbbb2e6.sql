-- Add FK from user_sessions to profiles for proper joins
-- First check if profiles has the same id as auth.users
-- profiles.id should match auth.users.id, so we can create this FK

ALTER TABLE public.user_sessions 
ADD CONSTRAINT user_sessions_user_id_profiles_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
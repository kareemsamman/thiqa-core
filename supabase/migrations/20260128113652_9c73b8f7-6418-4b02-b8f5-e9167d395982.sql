-- Add PBX extension field to profiles table for Click-to-Call feature
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS pbx_extension TEXT DEFAULT NULL;

COMMENT ON COLUMN profiles.pbx_extension IS 'رقم تحويلة PBX للموظف - يستخدم لخاصية الاتصال بالضغط';
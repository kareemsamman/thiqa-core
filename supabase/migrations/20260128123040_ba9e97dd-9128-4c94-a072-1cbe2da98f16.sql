-- Create pbx_extensions table for multiple extensions management
CREATE TABLE public.pbx_extensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  extension_number TEXT NOT NULL,
  extension_name TEXT,
  password_plain TEXT NOT NULL,
  password_md5 TEXT NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.pbx_extensions ENABLE ROW LEVEL SECURITY;

-- Create policy for admin access only using has_role function
CREATE POLICY "Admins can manage extensions"
  ON public.pbx_extensions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Create function to compute MD5 automatically
CREATE OR REPLACE FUNCTION public.compute_md5_password()
RETURNS TRIGGER AS $$
BEGIN
  NEW.password_md5 := md5(NEW.password_plain);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic MD5 computation
CREATE TRIGGER trigger_compute_md5
  BEFORE INSERT OR UPDATE ON public.pbx_extensions
  FOR EACH ROW
  EXECUTE FUNCTION public.compute_md5_password();
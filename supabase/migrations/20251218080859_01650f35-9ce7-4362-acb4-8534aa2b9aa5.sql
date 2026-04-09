-- Create insurance_categories table for dynamic category management
CREATE TABLE public.insurance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_ar text,
  name_he text,
  slug text UNIQUE NOT NULL,
  mode text NOT NULL DEFAULT 'LIGHT' CHECK (mode IN ('FULL', 'LIGHT')),
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.insurance_categories ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Active users can view insurance categories"
  ON public.insurance_categories FOR SELECT
  USING (is_active_user(auth.uid()));

CREATE POLICY "Admins can manage insurance categories"
  ON public.insurance_categories FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Updated_at trigger
CREATE TRIGGER update_insurance_categories_updated_at
  BEFORE UPDATE ON public.insurance_categories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one default category
CREATE OR REPLACE FUNCTION public.ensure_single_default_category()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.insurance_categories
    SET is_default = false
    WHERE id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER ensure_single_default_category_trigger
  BEFORE INSERT OR UPDATE ON public.insurance_categories
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION ensure_single_default_category();

-- Seed with existing policy types
INSERT INTO public.insurance_categories (name, name_ar, name_he, slug, mode, is_active, is_default, sort_order) VALUES
  ('Car Insurance', 'تأمين السيارات', 'ביטוח רכב', 'THIRD_FULL', 'FULL', true, true, 1),
  ('Mandatory Insurance', 'تأمين إلزامي', 'ביטוח חובה', 'ELZAMI', 'LIGHT', true, false, 2),
  ('Road Service', 'خدمة الطريق', 'שירות דרכים', 'ROAD_SERVICE', 'LIGHT', true, false, 3),
  ('Accident Fee Exemption', 'إعفاء رسوم الحوادث', 'פטור מאגרת תאונות', 'ACCIDENT_FEE_EXEMPTION', 'LIGHT', true, false, 4);
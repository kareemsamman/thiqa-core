-- Add selling_price column to company_road_service_prices
ALTER TABLE public.company_road_service_prices
ADD COLUMN selling_price numeric NOT NULL DEFAULT 0;

-- Add selling_price column to company_accident_fee_prices
ALTER TABLE public.company_accident_fee_prices
ADD COLUMN selling_price numeric NOT NULL DEFAULT 0;

-- Add comment explaining the fields
COMMENT ON COLUMN public.company_road_service_prices.company_cost IS 'What AB pays to the insurance company';
COMMENT ON COLUMN public.company_road_service_prices.selling_price IS 'What AB charges the customer (سعر البيع)';

COMMENT ON COLUMN public.company_accident_fee_prices.company_cost IS 'What AB pays to the insurance company';
COMMENT ON COLUMN public.company_accident_fee_prices.selling_price IS 'What AB charges the customer (سعر البيع)';
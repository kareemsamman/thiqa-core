
-- Add voucher system columns to expenses table
ALTER TABLE public.expenses 
ADD COLUMN IF NOT EXISTS voucher_type TEXT NOT NULL DEFAULT 'payment',
ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS reference_number TEXT,
ADD COLUMN IF NOT EXISTS contact_name TEXT;

-- Add validation trigger for voucher_type
CREATE OR REPLACE FUNCTION public.validate_expense_voucher_type()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.voucher_type NOT IN ('receipt', 'payment') THEN
    RAISE EXCEPTION 'voucher_type must be receipt or payment';
  END IF;
  IF NEW.payment_method NOT IN ('cash', 'cheque', 'bank_transfer', 'visa') THEN
    RAISE EXCEPTION 'payment_method must be cash, cheque, bank_transfer, or visa';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_expense_voucher_type_trigger
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW
EXECUTE FUNCTION public.validate_expense_voucher_type();

-- Add index for faster filtering
CREATE INDEX IF NOT EXISTS idx_expenses_voucher_type ON public.expenses(voucher_type);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON public.expenses(payment_method);

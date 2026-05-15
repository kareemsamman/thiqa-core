-- ─────────────────────────────────────────────────────────────
-- receipts: recipient_name + recipient_category for "آخر" voucher
-- ─────────────────────────────────────────────────────────────
--
-- The receipts table currently routes a voucher to one of three FK
-- columns: client_id (customer), broker_id (broker), company_id
-- (insurance company). Vouchers issued to external parties — utility
-- companies, lawyers, garages, salary recipients — don't fit any of
-- those, so the AddVoucherDialog hid the "آخر" option behind a
-- قريباً badge.
--
-- We add two nullable columns:
--   • recipient_name      — free-text label ("شركة الكهرباء أبريل
--                            2026", "محامي تامر", "كراج إبراهيم")
--   • recipient_category  — broad bucket for reporting (utility /
--                            salary / legal / maintenance / etc.).
--                            Application uses an enum-like list,
--                            but storing as text keeps it future-
--                            proof for custom categories.
--
-- No constraint pinning client_id/broker_id/company_id to null when
-- recipient_name is set — keeps existing rows valid and avoids
-- breaking any code path that might end up writing all three. The
-- /receipts page identifies "آخر" rows by all FK columns being null
-- AND recipient_name being set, which is sufficient.
--
-- Voucher numbering reuses the existing allocators (R / D / C / M)
-- so "آخر" rows print in the same sequence as their typed siblings.

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS recipient_name TEXT,
  ADD COLUMN IF NOT EXISTS recipient_category TEXT;

COMMENT ON COLUMN public.receipts.recipient_name IS
  'External party label for "آخر" vouchers — utility company, lawyer, garage, salary recipient, etc. NULL when the voucher is tied to a client/broker/company FK.';

COMMENT ON COLUMN public.receipts.recipient_category IS
  'Broad reporting category for external-party vouchers — utility / salary / legal / maintenance / office_supplies / marketing / tax_fees / other. Free-text on save so the app can grow the list without a schema change.';

-- Index supports the per-agent search/filter on /receipts when the
-- user types into the search box. trgm covers partial-match search
-- on the recipient name; the smaller recipient_category index gates
-- the dropdown filter.
CREATE INDEX IF NOT EXISTS receipts_recipient_name_trgm_idx
  ON public.receipts USING gin (recipient_name gin_trgm_ops)
  WHERE recipient_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS receipts_recipient_category_idx
  ON public.receipts (recipient_category)
  WHERE recipient_category IS NOT NULL;

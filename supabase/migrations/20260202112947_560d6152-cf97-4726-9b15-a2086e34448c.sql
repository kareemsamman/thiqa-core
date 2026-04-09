-- Fix: Remove duplicate function overload causing "function is not unique" error
-- There are two versions of report_renewals_summary:
--   1. p_end_month date (OID 73363) - OLD
--   2. p_end_month text (OID 73365) - NEW (correct one)
-- 
-- Keep only the TEXT version which handles null/empty string properly

DROP FUNCTION IF EXISTS public.report_renewals_summary(date, text, uuid, text);
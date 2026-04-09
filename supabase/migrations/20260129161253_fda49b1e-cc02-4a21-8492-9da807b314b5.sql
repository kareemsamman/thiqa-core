-- إزالة الدالة المكررة ذات المعامل الواحد
-- هذا يحل مشكلة "function report_renewals_summary(date) is not unique"
DROP FUNCTION IF EXISTS public.report_renewals_summary(date);
-- Enable pg_cron for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Auto-cash cheque payments when the due date (payment_date) is today or in the past.
-- Only transitions: (NULL|pending) -> cashed.
DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'cheque_status_auto_cash'
  ) THEN
    PERFORM cron.schedule(
      'cheque_status_auto_cash',
      '5 * * * *',
      $job$
      UPDATE public.policy_payments
      SET cheque_status = 'cashed'
      WHERE payment_type = 'cheque'
        AND (cheque_status IS NULL OR cheque_status = 'pending')
        AND payment_date <= CURRENT_DATE;
      $job$
    );
  END IF;
END
$block$;

-- Add broker_direction enum and column to policies table
-- 'from_broker' = broker is working for us (الوسيط يعمل لنا)
-- 'to_broker' = we are working for the broker (نعمل للوسيط)

CREATE TYPE public.broker_direction AS ENUM ('from_broker', 'to_broker');

ALTER TABLE public.policies 
ADD COLUMN broker_direction public.broker_direction NULL;
-- Create table for storing WhatsApp conversation messages
CREATE TABLE public.lead_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL,
  message_type VARCHAR(10) NOT NULL CHECK (message_type IN ('ai', 'human')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient queries
CREATE INDEX idx_lead_messages_lead_id ON public.lead_messages(lead_id);
CREATE INDEX idx_lead_messages_phone ON public.lead_messages(phone);
CREATE INDEX idx_lead_messages_created_at ON public.lead_messages(created_at DESC);

-- Enable RLS
ALTER TABLE public.lead_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for admins
CREATE POLICY "Admins can view all lead messages"
  ON public.lead_messages FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert lead messages"
  ON public.lead_messages FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for workers
CREATE POLICY "Workers can view all lead messages"
  ON public.lead_messages FOR SELECT
  USING (public.has_role(auth.uid(), 'worker'));

CREATE POLICY "Workers can insert lead messages"
  ON public.lead_messages FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'worker'));

-- Add column to leads table to track last sync time
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS requires_callback BOOLEAN DEFAULT FALSE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS callback_notified_at TIMESTAMP WITH TIME ZONE;

-- Enable Realtime for lead_messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_messages;
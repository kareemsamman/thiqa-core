import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAgentContext } from "./useAgentContext";

export interface SiteSettings {
  id: string;
  site_title: string;
  site_description: string;
  logo_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  signature_header_html: string | null;
  signature_body_html: string | null;
  signature_footer_html: string | null;
  signature_primary_color: string | null;
  owner_name: string | null;
  tax_number: string | null;
  invoice_privacy_text: string | null;
  invoice_phones: string[] | null;
  invoice_address: string | null;
  updated_at: string;
  updated_by: string | null;
}

export function useSiteSettings() {
  const { agentId } = useAgentContext();

  return useQuery({
    queryKey: ["site-settings", agentId],
    enabled: Boolean(agentId),
    queryFn: async (): Promise<SiteSettings | null> => {
      if (!agentId) return null;

      const { data, error } = await supabase
        .from("site_settings")
        .select("*")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (error) throw error;
      return (data as SiteSettings) || null;
    },
    staleTime: 1000 * 60 * 30,
  });
}

export function useUpdateSiteSettings() {
  const queryClient = useQueryClient();
  const { agentId } = useAgentContext();

  return useMutation({
    mutationFn: async (updates: Partial<Omit<SiteSettings, "id" | "updated_at" | "updated_by">>) => {
      if (!agentId) throw new Error("Agent context not found");

      const { data: existing, error: existingError } = await supabase
        .from("site_settings")
        .select("id")
        .eq("agent_id", agentId)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.id) {
        const { data, error } = await supabase
          .from("site_settings")
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
          .select()
          .single();

        if (error) throw error;
        return data;
      }

      const { data, error } = await supabase
        .from("site_settings")
        .insert({
          agent_id: agentId,
          site_title: updates.site_title ?? "Thiqa",
          site_description: updates.site_description ?? "",
          logo_url: updates.logo_url ?? null,
          favicon_url: updates.favicon_url ?? null,
          og_image_url: updates.og_image_url ?? null,
          signature_header_html: updates.signature_header_html ?? null,
          signature_body_html: updates.signature_body_html ?? null,
          signature_footer_html: updates.signature_footer_html ?? null,
          signature_primary_color: updates.signature_primary_color ?? '#1e3a5f',
          owner_name: updates.owner_name ?? null,
          tax_number: updates.tax_number ?? null,
          invoice_privacy_text: updates.invoice_privacy_text ?? null,
          invoice_phones: updates.invoice_phones ?? [],
          invoice_address: updates.invoice_address ?? null,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["site-settings", agentId] });
      queryClient.removeQueries({ queryKey: ["site-settings"], exact: true });
    },
  });
}
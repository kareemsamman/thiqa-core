import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LandingContentMap = Record<string, { text_value: string | null; image_url: string | null; json_value: any }>;

export function useLandingContent() {
  return useQuery({
    queryKey: ["landing-content"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("landing_content" as any)
        .select("section_key, text_value, image_url, json_value");
      if (error) throw error;
      const map: LandingContentMap = {};
      (data as any[])?.forEach((row: any) => {
        map[row.section_key] = {
          text_value: row.text_value,
          image_url: row.image_url,
          json_value: row.json_value,
        };
      });
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Helper to get text with fallback */
export function ct(content: LandingContentMap | undefined, key: string, fallback: string): string {
  return content?.[key]?.text_value || fallback;
}

/** Helper to get image URL with fallback */
export function ci(content: LandingContentMap | undefined, key: string, fallback: string): string {
  return content?.[key]?.image_url || fallback;
}

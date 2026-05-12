import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Click2CallExtension {
  id: string;
  number: string;
  label: string | null;
  is_default: boolean;
}

export interface Click2CallState {
  enabled: boolean;
  provider: string | null;
  extensions: Click2CallExtension[];
}

const EMPTY_STATE: Click2CallState = {
  enabled: false,
  provider: null,
  extensions: [],
};

/**
 * Surfaces the current user's Click2Call configuration to the UI.
 *
 * Reads via the get_my_click2call_state SECURITY DEFINER RPC, which
 * omits api_key. We cache it under the user's id so impersonation
 * (which swaps the auth.uid()) doesn't read another user's cached
 * state by accident.
 *
 * `enabled` is false until we know otherwise — call buttons stay
 * hidden during hydration rather than flashing in for a frame.
 */
export function useClick2Call() {
  const { user } = useAuth();

  const query = useQuery<Click2CallState>({
    queryKey: ["click2call-state", user?.id ?? null],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_my_click2call_state");
      if (error) throw error;
      const rows = (data as Array<{
        is_enabled: boolean;
        provider: string;
        extension_id: string | null;
        extension_number: string | null;
        extension_label: string | null;
        extension_is_default: boolean | null;
      }> | null) ?? [];
      if (rows.length === 0) return EMPTY_STATE;

      const first = rows[0];
      const extensions: Click2CallExtension[] = rows
        .filter((r) => r.extension_id && r.extension_number)
        .map((r) => ({
          id: r.extension_id!,
          number: r.extension_number!,
          label: r.extension_label,
          is_default: !!r.extension_is_default,
        }));

      return {
        enabled: first.is_enabled,
        provider: first.provider,
        extensions,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const state = query.data ?? EMPTY_STATE;
  return {
    ...state,
    // A worker with an enabled config but zero extensions still can't
    // place a call — surface that as "not ready" so the button stays
    // hidden and we don't open a dialog with an empty picker.
    ready: state.enabled && state.extensions.length > 0,
    loading: query.isLoading,
  };
}

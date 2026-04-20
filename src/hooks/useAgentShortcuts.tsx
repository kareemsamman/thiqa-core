// Fetch the agent's shortcut overrides and merge them with the code
// defaults into a single `combo → action` lookup. Consumers (the global
// listener, the admin UI) read the merged view; the admin UI also gets
// a mutation to upsert a binding.

import { useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAgentContext } from '@/hooks/useAgentContext';
import { useAuth } from '@/hooks/useAuth';
import { SHORTCUT_ACTIONS, type ShortcutActionKey } from '@/lib/shortcuts';

export interface ShortcutBinding {
  action: ShortcutActionKey;
  // Normalized "ctrl+n" style string. `null` = explicitly unbound (the
  // admin cleared the key or the default was null).
  combination: string | null;
  enabled: boolean;
  // Whether the binding comes from a saved DB row vs. a code default.
  // The admin UI uses this to render "افتراضي" vs "مخصص" badges.
  source: 'default' | 'override';
}

interface AgentShortcutRow {
  agent_id: string;
  action_key: string;
  key_combination: string | null;
  enabled: boolean;
}

// All bindings (merged: DB override wins over code default).
export function useAgentShortcuts() {
  const { agentId } = useAgentContext();

  const query = useQuery({
    queryKey: ['agent-shortcuts', agentId],
    queryFn: async () => {
      if (!agentId) return [] as AgentShortcutRow[];
      const { data, error } = await supabase
        .from('agent_shortcuts')
        .select('agent_id, action_key, key_combination, enabled')
        .eq('agent_id', agentId);
      if (error) throw error;
      return (data || []) as AgentShortcutRow[];
    },
    enabled: !!agentId,
    staleTime: 60_000,
  });

  const bindings = useMemo<ShortcutBinding[]>(() => {
    const overrides = new Map<string, AgentShortcutRow>(
      (query.data || []).map((r) => [r.action_key, r]),
    );
    return SHORTCUT_ACTIONS.map((a) => {
      const ov = overrides.get(a.key);
      if (ov) {
        return {
          action: a.key,
          combination: ov.key_combination,
          enabled: ov.enabled,
          source: 'override' as const,
        };
      }
      return {
        action: a.key,
        combination: a.defaultCombo,
        enabled: true,
        source: 'default' as const,
      };
    });
  }, [query.data]);

  // Reverse lookup used by the global listener: combo → action.
  // Duplicate combos would collide; we pick the LAST one set so a later
  // override cleanly displaces an earlier one.
  const comboToAction = useMemo(() => {
    const map = new Map<string, ShortcutActionKey>();
    bindings.forEach((b) => {
      if (!b.enabled) return;
      if (!b.combination) return;
      map.set(b.combination.toLowerCase(), b.action);
    });
    return map;
  }, [bindings]);

  return {
    bindings,
    comboToAction,
    loading: query.isLoading,
  };
}

export function useUpdateAgentShortcut() {
  const { agentId } = useAgentContext();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      action: ShortcutActionKey;
      combination: string | null;
      enabled: boolean;
    }) => {
      if (!agentId) throw new Error('لا يوجد وكيل نشط');
      const { error } = await supabase
        .from('agent_shortcuts')
        .upsert(
          {
            agent_id: agentId,
            action_key: input.action,
            key_combination: input.combination,
            enabled: input.enabled,
            updated_by_admin_id: user?.id || null,
          },
          { onConflict: 'agent_id,action_key' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-shortcuts', agentId] });
    },
  });
}

// Delete an override so the action falls back to its code default.
export function useResetAgentShortcut() {
  const { agentId } = useAgentContext();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (action: ShortcutActionKey) => {
      if (!agentId) throw new Error('لا يوجد وكيل نشط');
      const { error } = await supabase
        .from('agent_shortcuts')
        .delete()
        .eq('agent_id', agentId)
        .eq('action_key', action);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-shortcuts', agentId] });
    },
  });
}

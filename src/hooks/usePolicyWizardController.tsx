import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

// Per-user wizard drafts now live in the policy_wizard_drafts table —
// see migration 20260429100000_policy_wizard_drafts.sql. localStorage
// keys are kept here ONLY to wipe the legacy unscoped data so old
// "ghost" badges don't follow new users on a shared device.
const LEGACY_INSTANCES_KEY_V1 = "abcrm:policyWizardInstances:v1";
const LEGACY_INSTANCES_KEY_V2_PREFIX = "abcrm:policyWizardInstances:v2";

export interface WizardDraftSummary {
  clientName: string;
  stepTitle: string;
  stepNumber: number;
  totalSteps: number;
  categoryName: string | null;
}

interface DockOrigin {
  x: number;
  y: number;
}

export interface WizardInstance {
  id: string;
  preselectedClientId?: string;
  draftSummary: WizardDraftSummary | null;
  // Timestamp of the FIRST time this draft was minimized. Stays fixed
  // across later restore/minimize cycles so the drafts list can sort and
  // label each chip by when the user parked it originally.
  minimizedAt: number | null;
}

interface PolicyWizardControllerState {
  // Multi-instance API
  instances: WizardInstance[];
  activeId: string | null;
  openWizard: (opts?: { clientId?: string }) => string;
  closeInstance: (id: string) => void;
  minimizeInstance: (id: string, origin?: DockOrigin) => void;
  restoreInstance: (id: string) => void;
  setInstanceDraft: (id: string, summary: WizardDraftSummary | null) => void;
  consumeDockOrigin: () => DockOrigin | null;

  // Convenience accessors for the currently active instance
  isOpen: boolean;
  isCollapsed: boolean;
  preselectedClientId: string | undefined;
  draftSummary: WizardDraftSummary | null;

  // Backward-compat shims operating on the active instance
  closeWizard: () => void;
  minimizeWizard: (origin?: DockOrigin) => void;
  restoreWizard: () => void;
  setDraftSummary: (summary: WizardDraftSummary | null) => void;
  setCollapsed: (collapsed: boolean) => void;
}

const PolicyWizardControllerContext = createContext<PolicyWizardControllerState | null>(null);

function generateId(): string {
  return (
    Math.random().toString(36).slice(2, 11) + Date.now().toString(36).slice(-4)
  );
}

// supabase types haven't been regenerated for the new table yet; cast
// once here so the rest of the file reads cleanly.
const drafts = () => (supabase as any).from("policy_wizard_drafts");

interface DraftRow {
  id: string;
  preselected_client_id: string | null;
  draft_summary: WizardDraftSummary | null;
  minimized_at: string | null;
}

function rowToInstance(row: DraftRow): WizardInstance {
  return {
    id: row.id,
    preselectedClientId: row.preselected_client_id || undefined,
    draftSummary: row.draft_summary || null,
    minimizedAt: row.minimized_at ? new Date(row.minimized_at).getTime() : null,
  };
}

// One-time cleanup of legacy localStorage keys. Runs on every mount
// because it's cheap (no-op when keys are absent) and self-healing.
function wipeLegacyKeys(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_INSTANCES_KEY_V1);
    // Wipe every v2:<userId> key too — they're all replaced by the DB.
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${LEGACY_INSTANCES_KEY_V2_PREFIX}:`)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // non-fatal
  }
}

export function PolicyWizardControllerProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id || null;
  const agentId = profile?.agent_id || null;

  const [instances, setInstances] = useState<WizardInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);
  const dockOriginRef = useRef<DockOrigin | null>(null);

  // Wipe legacy localStorage drafts once. They're now superseded by
  // the DB, and leaving them around just risks confusing future
  // debugging.
  useEffect(() => { wipeLegacyKeys(); }, []);

  // Load the current user's drafts from the DB on mount + every time
  // the active user changes (sign-in / sign-out / account swap).
  useEffect(() => {
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    setActiveId(null);
    if (!userId) {
      setInstances([]);
      return;
    }
    let cancelled = false;
    drafts()
      .select("id, preselected_client_id, draft_summary, minimized_at")
      .order("created_at", { ascending: true })
      .then(({ data, error }: { data: DraftRow[] | null; error: unknown }) => {
        if (cancelled) return;
        if (error) {
          console.error("[PolicyWizardController] load drafts failed:", error);
          setInstances([]);
          return;
        }
        setInstances((data || []).map(rowToInstance));
      });
    return () => { cancelled = true; };
  }, [userId]);

  const openWizard = useCallback((opts?: { clientId?: string }): string => {
    const id = generateId();
    if (!userId) return id; // no auth yet — open in-memory only
    setInstances((prev) => [
      ...prev,
      { id, preselectedClientId: opts?.clientId, draftSummary: null, minimizedAt: null },
    ]);
    setActiveId(id);
    drafts().insert({
      id,
      user_id: userId,
      agent_id: agentId,
      preselected_client_id: opts?.clientId || null,
      draft_summary: null,
      form_snapshot: null,
      minimized_at: null,
    }).then(({ error }: { error: unknown }) => {
      if (error) console.error("[PolicyWizardController] insert failed:", error);
    });
    return id;
  }, [userId, agentId]);

  const closeInstance = useCallback((id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
    drafts().delete().eq("id", id).then(({ error }: { error: unknown }) => {
      if (error) console.error("[PolicyWizardController] delete failed:", error);
    });
  }, []);

  const minimizeInstance = useCallback((id: string, origin?: DockOrigin) => {
    if (origin) dockOriginRef.current = origin;
    setActiveId((prev) => (prev === id ? null : prev));
    let stamp: number | null = null;
    setInstances((prev) =>
      prev.map((i) => {
        if (i.id !== id || i.minimizedAt != null) return i;
        stamp = Date.now();
        return { ...i, minimizedAt: stamp };
      }),
    );
    if (stamp != null) {
      drafts().update({ minimized_at: new Date(stamp).toISOString() }).eq("id", id)
        .then(({ error }: { error: unknown }) => {
          if (error) console.error("[PolicyWizardController] minimize failed:", error);
        });
    }
  }, []);

  const restoreInstance = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const setInstanceDraft = useCallback(
    (id: string, summary: WizardDraftSummary | null) => {
      setInstances((prev) =>
        prev.map((i) => (i.id === id ? { ...i, draftSummary: summary } : i)),
      );
      drafts().update({ draft_summary: summary }).eq("id", id)
        .then(({ error }: { error: unknown }) => {
          if (error) console.error("[PolicyWizardController] update summary failed:", error);
        });
    },
    [],
  );

  const consumeDockOrigin = useCallback(() => {
    const origin = dockOriginRef.current;
    dockOriginRef.current = null;
    return origin;
  }, []);

  // Convenience accessors — always look up the active instance fresh so the
  // values track as the user restores/minimizes/closes wizards.
  const activeInstance = instances.find((i) => i.id === activeId) || null;
  const isOpen = instances.length > 0;
  const isCollapsed = activeId === null && instances.length > 0;
  const preselectedClientId = activeInstance?.preselectedClientId;
  const draftSummary = activeInstance?.draftSummary || null;

  // Backward-compat single-wizard operations (all route through the active
  // instance). Existing callers — BottomToolbar, GlobalPolicyWizardHost,
  // Policies page — can keep using these until they migrate.
  const closeWizard = useCallback(() => {
    if (activeId) closeInstance(activeId);
  }, [activeId, closeInstance]);

  const minimizeWizard = useCallback(
    (origin?: DockOrigin) => {
      if (activeId) minimizeInstance(activeId, origin);
    },
    [activeId, minimizeInstance],
  );

  const restoreWizard = useCallback(() => {
    // Restore the first minimized instance (there is usually only one in
    // the single-wizard code path).
    const candidate = instances.find((i) => i.id !== activeId);
    if (candidate) setActiveId(candidate.id);
  }, [instances, activeId]);

  const setDraftSummary = useCallback(
    (summary: WizardDraftSummary | null) => {
      if (activeId) setInstanceDraft(activeId, summary);
    },
    [activeId, setInstanceDraft],
  );

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      if (collapsed && activeId) {
        minimizeInstance(activeId);
      } else if (!collapsed && instances.length > 0) {
        const first = instances[0];
        if (first) setActiveId(first.id);
      }
    },
    [activeId, instances, minimizeInstance],
  );

  const value = useMemo<PolicyWizardControllerState>(
    () => ({
      instances,
      activeId,
      openWizard,
      closeInstance,
      minimizeInstance,
      restoreInstance,
      setInstanceDraft,
      consumeDockOrigin,
      isOpen,
      isCollapsed,
      preselectedClientId,
      draftSummary,
      closeWizard,
      minimizeWizard,
      restoreWizard,
      setDraftSummary,
      setCollapsed,
    }),
    [
      instances,
      activeId,
      openWizard,
      closeInstance,
      minimizeInstance,
      restoreInstance,
      setInstanceDraft,
      consumeDockOrigin,
      isOpen,
      isCollapsed,
      preselectedClientId,
      draftSummary,
      closeWizard,
      minimizeWizard,
      restoreWizard,
      setDraftSummary,
      setCollapsed,
    ],
  );

  return (
    <PolicyWizardControllerContext.Provider value={value}>
      {children}
    </PolicyWizardControllerContext.Provider>
  );
}

export function usePolicyWizardController() {
  const ctx = useContext(PolicyWizardControllerContext);
  if (!ctx) {
    throw new Error("usePolicyWizardController must be used inside PolicyWizardControllerProvider");
  }
  return ctx;
}

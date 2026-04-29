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

// Persist the list of open/minimized wizard instances across a page
// refresh so the tab strip in the bottom toolbar survives a reload.
// Stored in localStorage so drafts also survive closing and reopening
// the browser tab, not just a single session.
//
// The key is suffixed by the user_id so two users sharing the same
// device (or one user signing out and another signing in) don't see
// each other's parked drafts. A worker should never inherit a manager's
// minimized policy because they happened to use the same browser.
const INSTANCES_STORAGE_PREFIX = "abcrm:policyWizardInstances:v2";

// Per-instance form draft key prefix. Kept in sync with the one in
// usePolicyWizardState so the controller can clean up orphaned drafts
// when the user closes a tab from the toolbar without opening it first.
const DRAFT_KEY_PREFIX = "abcrm:policyWizardDraft:v4";

// Legacy unscoped key — wiped on first load of the new code so the
// "3 minimized" badge from a prior tenant doesn't follow a fresh user.
const LEGACY_INSTANCES_KEY = "abcrm:policyWizardInstances:v1";

function instancesKeyFor(userId: string | null): string | null {
  if (!userId) return null;
  return `${INSTANCES_STORAGE_PREFIX}:${userId}`;
}

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

function loadPersistedInstances(userId: string | null): WizardInstance[] {
  if (typeof window === "undefined" || !userId) return [];
  const key = instancesKeyFor(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to well-shaped entries and ignore anything that looks broken.
    // Backfill minimizedAt for older persisted drafts that predate the
    // field so they still sort/show a timestamp.
    return parsed
      .filter(
        (entry): entry is WizardInstance =>
          entry && typeof entry === "object" && typeof entry.id === "string",
      )
      .map((entry) => ({
        ...entry,
        minimizedAt:
          typeof entry.minimizedAt === "number" ? entry.minimizedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function persistInstances(userId: string | null, instances: WizardInstance[]): void {
  if (typeof window === "undefined" || !userId) return;
  const key = instancesKeyFor(userId);
  if (!key) return;
  try {
    if (instances.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(instances));
    }
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function PolicyWizardControllerProvider({ children }: { children: ReactNode }) {
  // user.id scopes the localStorage key so two users on the same
  // device never share each other's minimized drafts. Auth provider
  // sits above this provider in the App tree, so the hook is always
  // available.
  const { user } = useAuth();
  const userId = user?.id || null;

  // Rehydrate from localStorage on mount AND every time the active user
  // changes. Everything reloads as "minimized" (activeId stays null) —
  // the user explicitly clicks a tab to restore.
  const [instances, setInstances] = useState<WizardInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  // Wipe the unscoped legacy key once. It belonged to whoever happened
  // to use the device first under the old code and shows up as a
  // ghost "3 minimized" badge for every fresh signup until cleared.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { localStorage.removeItem(LEGACY_INSTANCES_KEY); } catch { /* non-fatal */ }
  }, []);

  // Reload instances on user change (sign-in / sign-out / account swap).
  // Drop any open editor when the user changes — the wizard belongs to
  // the previous identity.
  useEffect(() => {
    if (lastUserIdRef.current === userId) return;
    lastUserIdRef.current = userId;
    setInstances(loadPersistedInstances(userId));
    setActiveId(null);
  }, [userId]);

  useEffect(() => {
    persistInstances(userId, instances);
  }, [userId, instances]);
  // Dock origin for the minimize→chip flight animation. Consumed exactly
  // once by the next chip render so it must not drive re-renders itself.
  const dockOriginRef = useRef<DockOrigin | null>(null);

  const openWizard = useCallback((opts?: { clientId?: string }): string => {
    const id = generateId();
    setInstances((prev) => [
      ...prev,
      { id, preselectedClientId: opts?.clientId, draftSummary: null, minimizedAt: null },
    ]);
    setActiveId(id);
    return id;
  }, []);

  const closeInstance = useCallback((id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
    // Remove the orphaned per-instance form draft so it doesn't leak
    // localStorage after closing a minimized tab from the toolbar.
    try {
      localStorage.removeItem(`${DRAFT_KEY_PREFIX}:${id}`);
    } catch {
      // ignore
    }
  }, []);

  const minimizeInstance = useCallback((id: string, origin?: DockOrigin) => {
    if (origin) dockOriginRef.current = origin;
    setActiveId((prev) => (prev === id ? null : prev));
    // Stamp the first-minimize time only. Re-minimizing the same draft
    // must not refresh its position in the list — the "last minimized"
    // ordering is about original parking time, not most recent touch.
    setInstances((prev) =>
      prev.map((i) => (i.id === id && i.minimizedAt == null ? { ...i, minimizedAt: Date.now() } : i)),
    );
  }, []);

  const restoreInstance = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const setInstanceDraft = useCallback(
    (id: string, summary: WizardDraftSummary | null) => {
      setInstances((prev) =>
        prev.map((i) => (i.id === id ? { ...i, draftSummary: summary } : i)),
      );
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

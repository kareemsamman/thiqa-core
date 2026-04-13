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

// Persist the list of open/minimized wizard instances across a page
// refresh so the tab strip in the bottom toolbar survives a reload.
// Stored in sessionStorage: stays for the tab's lifetime but doesn't
// leak between browser sessions or other tabs.
const INSTANCES_STORAGE_KEY = "abcrm:policyWizardInstances:v1";

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

function loadPersistedInstances(): WizardInstance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(INSTANCES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to well-shaped entries and ignore anything that looks broken.
    return parsed.filter(
      (entry): entry is WizardInstance =>
        entry && typeof entry === "object" && typeof entry.id === "string",
    );
  } catch {
    return [];
  }
}

function persistInstances(instances: WizardInstance[]): void {
  if (typeof window === "undefined") return;
  try {
    if (instances.length === 0) {
      sessionStorage.removeItem(INSTANCES_STORAGE_KEY);
    } else {
      sessionStorage.setItem(INSTANCES_STORAGE_KEY, JSON.stringify(instances));
    }
  } catch {
    // storage full / disabled — non-fatal
  }
}

export function PolicyWizardControllerProvider({ children }: { children: ReactNode }) {
  // Rehydrate from sessionStorage on mount so a page refresh doesn't
  // drop the user's minimized drafts. Everything reloads as "minimized"
  // (activeId stays null) — the user explicitly clicks a tab to restore.
  const [instances, setInstances] = useState<WizardInstance[]>(() => loadPersistedInstances());
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    persistInstances(instances);
  }, [instances]);
  // Dock origin for the minimize→chip flight animation. Consumed exactly
  // once by the next chip render so it must not drive re-renders itself.
  const dockOriginRef = useRef<DockOrigin | null>(null);

  const openWizard = useCallback((opts?: { clientId?: string }): string => {
    const id = generateId();
    setInstances((prev) => [
      ...prev,
      { id, preselectedClientId: opts?.clientId, draftSummary: null },
    ]);
    setActiveId(id);
    return id;
  }, []);

  const closeInstance = useCallback((id: string) => {
    setInstances((prev) => prev.filter((i) => i.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const minimizeInstance = useCallback((id: string, origin?: DockOrigin) => {
    if (origin) dockOriginRef.current = origin;
    setActiveId((prev) => (prev === id ? null : prev));
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

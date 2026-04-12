import { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from "react";

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

interface PolicyWizardControllerState {
  isOpen: boolean;
  isCollapsed: boolean;
  preselectedClientId: string | undefined;
  draftSummary: WizardDraftSummary | null;
  openWizard: (opts?: { clientId?: string }) => void;
  closeWizard: () => void;
  minimizeWizard: (origin?: DockOrigin) => void;
  restoreWizard: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setDraftSummary: (summary: WizardDraftSummary | null) => void;
  consumeDockOrigin: () => DockOrigin | null;
}

const PolicyWizardControllerContext = createContext<PolicyWizardControllerState | null>(null);

export function PolicyWizardControllerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [preselectedClientId, setPreselectedClientId] = useState<string | undefined>(undefined);
  const [draftSummary, setDraftSummary] = useState<WizardDraftSummary | null>(null);
  // Dock origin is stored in a ref, not state: it's consumed exactly once
  // by the next chip render and must not trigger re-renders on its own.
  const dockOriginRef = useRef<DockOrigin | null>(null);

  const openWizard = useCallback((opts?: { clientId?: string }) => {
    setPreselectedClientId(opts?.clientId);
    setIsCollapsed(false);
    setIsOpen(true);
  }, []);

  const closeWizard = useCallback(() => {
    setIsOpen(false);
    setIsCollapsed(false);
    setPreselectedClientId(undefined);
    setDraftSummary(null);
    dockOriginRef.current = null;
  }, []);

  const minimizeWizard = useCallback((origin?: DockOrigin) => {
    if (origin) dockOriginRef.current = origin;
    setIsCollapsed(true);
  }, []);

  const restoreWizard = useCallback(() => {
    setIsCollapsed(false);
  }, []);

  const consumeDockOrigin = useCallback(() => {
    const origin = dockOriginRef.current;
    dockOriginRef.current = null;
    return origin;
  }, []);

  const value = useMemo<PolicyWizardControllerState>(
    () => ({
      isOpen,
      isCollapsed,
      preselectedClientId,
      draftSummary,
      openWizard,
      closeWizard,
      minimizeWizard,
      restoreWizard,
      setCollapsed: setIsCollapsed,
      setDraftSummary,
      consumeDockOrigin,
    }),
    [isOpen, isCollapsed, preselectedClientId, draftSummary, openWizard, closeWizard, minimizeWizard, restoreWizard, consumeDockOrigin],
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

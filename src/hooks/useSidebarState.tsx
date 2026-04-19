import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

interface SidebarStateContextType {
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
}

const SidebarStateContext = createContext<SidebarStateContextType>({
  collapsed: false,
  setCollapsed: () => {},
});

// Persist the collapsed/expanded state across reloads. Read once on
// init (lazy initialiser so we don't re-read every render); write on
// every change. Wrapped in try/catch because localStorage can throw
// in private-mode / storage-restricted contexts.
const STORAGE_KEY = 'thiqa:sidebar:collapsed';

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage disabled — state still works in-memory for the session */
    }
  }, [collapsed]);

  return (
    <SidebarStateContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarStateContext.Provider>
  );
}

export function useSidebarState() {
  return useContext(SidebarStateContext);
}

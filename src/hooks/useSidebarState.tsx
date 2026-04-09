import { createContext, useContext, useState, ReactNode } from 'react';

interface SidebarStateContextType {
  collapsed: boolean;
  setCollapsed: (val: boolean) => void;
}

const SidebarStateContext = createContext<SidebarStateContextType>({
  collapsed: false,
  setCollapsed: () => {},
});

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <SidebarStateContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarStateContext.Provider>
  );
}

export function useSidebarState() {
  return useContext(SidebarStateContext);
}

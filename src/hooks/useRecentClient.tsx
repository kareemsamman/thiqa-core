import { useState, useEffect, createContext, useContext, ReactNode, useCallback, useMemo } from 'react';

interface RecentClient {
  id: string;
  name: string;
  initial: string;
}

interface RecentClientContextType {
  recentClient: RecentClient | null;
  setRecentClient: (client: RecentClient | null) => void;
  clearRecentClient: () => void;
}

const RecentClientContext = createContext<RecentClientContextType | null>(null);

const STORAGE_KEY = 'ab_recent_client';

export function RecentClientProvider({ children }: { children: ReactNode }) {
  const [recentClient, setRecentClientState] = useState<RecentClient | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setRecentClientState(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load recent client:', e);
    }
  }, []);

  const setRecentClient = useCallback((client: RecentClient | null) => {
    setRecentClientState(client);
    if (client) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(client));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearRecentClient = useCallback(() => {
    setRecentClientState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(() => ({
    recentClient,
    setRecentClient,
    clearRecentClient,
  }), [recentClient, setRecentClient, clearRecentClient]);

  return (
    <RecentClientContext.Provider value={value}>
      {children}
    </RecentClientContext.Provider>
  );
}

export function useRecentClient() {
  const context = useContext(RecentClientContext);
  // Return no-op functions if not in provider (for safety)
  if (!context) {
    return {
      recentClient: null,
      setRecentClient: () => {},
      clearRecentClient: () => {},
    };
  }
  return context;
}

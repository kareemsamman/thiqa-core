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

const STORAGE_KEY_PREFIX = 'ab_recent_client';

function getStorageKey(): string {
  // Scope by user to prevent cross-agent leaks
  try {
    const session = JSON.parse(localStorage.getItem('sb-oxsxmvxtblcideimcgnr-auth-token') || '{}');
    const userId = session?.user?.id;
    if (userId) return `${STORAGE_KEY_PREFIX}_${userId}`;
  } catch {}
  return STORAGE_KEY_PREFIX;
}

export function RecentClientProvider({ children }: { children: ReactNode }) {
  const [recentClient, setRecentClientState] = useState<RecentClient | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(getStorageKey());
      if (stored) {
        setRecentClientState(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load recent client:', e);
    }
  }, []);

  const setRecentClient = useCallback((client: RecentClient | null) => {
    setRecentClientState(client);
    const key = getStorageKey();
    if (client) {
      localStorage.setItem(key, JSON.stringify(client));
    } else {
      localStorage.removeItem(key);
    }
  }, []);

  const clearRecentClient = useCallback(() => {
    setRecentClientState(null);
    localStorage.removeItem(getStorageKey());
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

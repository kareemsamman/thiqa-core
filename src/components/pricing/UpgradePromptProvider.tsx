import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { UpgradePromptDialog, LimitResource } from './UpgradePromptDialog';

interface UpgradePromptState {
  // Quota-limit variant (e.g. hit the user cap, policy cap)
  resource?: LimitResource;
  current?: number;
  limit?: number;
  // Feature-lock variant (clicked a sidebar item the plan doesn't
  // include — e.g. Dashboard on Entry)
  featureLabel?: string;
  featureKey?: string;
}

interface UpgradePromptContextType {
  showUpgradePrompt: (params: UpgradePromptState) => void;
  /**
   * Parses a PostgresError / thrown Error whose message follows the
   * LIMIT_EXCEEDED:<resource>:<plan>:<current>:<effective_limit>
   * contract raised by the enforce_*_limit triggers, opens the popup
   * with the parsed data, and returns true if it matched (caller
   * should swallow the error). Returns false if the error was
   * something else — caller should re-throw / show its own toast.
   */
  handleLimitError: (error: unknown) => boolean;
}

const UpgradePromptContext = createContext<UpgradePromptContextType | undefined>(undefined);

const VALID_RESOURCES: LimitResource[] = [
  'users',
  'branches',
  'policies',
  'sms',
  'marketing_sms',
  'ai',
];

function extractMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const anyErr = error as { message?: string; error?: { message?: string } };
    return anyErr.message || anyErr.error?.message || '';
  }
  return '';
}

/**
 * Extracts resource + counts from a LIMIT_EXCEEDED:... error message
 * raised by the DB triggers. Returns null for anything unrelated.
 */
export function parseLimitError(error: unknown):
  | { resource: LimitResource; plan: string; current: number; limit: number }
  | null {
  const msg = extractMessage(error);
  if (!msg.includes('LIMIT_EXCEEDED')) return null;
  const match = msg.match(/LIMIT_EXCEEDED:([a-z_]+):([a-z_]+):(\d+):(\d+)/);
  if (!match) return null;
  const [, resource, plan, current, limit] = match;
  if (!VALID_RESOURCES.includes(resource as LimitResource)) return null;
  return {
    resource: resource as LimitResource,
    plan,
    current: Number(current),
    limit: Number(limit),
  };
}

/**
 * App-level provider holding the singleton dialog state. Mount once
 * inside the authenticated shell; every descendant can call
 * useUpgradePrompt() to open it.
 */
export function UpgradePromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpgradePromptState | null>(null);

  const showUpgradePrompt = useCallback((params: UpgradePromptState) => {
    setState(params);
    setOpen(true);
  }, []);

  const handleLimitError = useCallback(
    (error: unknown) => {
      const parsed = parseLimitError(error);
      if (!parsed) return false;
      showUpgradePrompt({
        resource: parsed.resource,
        current: parsed.current,
        limit: parsed.limit,
      });
      return true;
    },
    [showUpgradePrompt],
  );

  return (
    <UpgradePromptContext.Provider value={{ showUpgradePrompt, handleLimitError }}>
      {children}
      {state && (
        <UpgradePromptDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setState(null);
          }}
          resource={state.resource}
          current={state.current}
          limit={state.limit}
          featureLabel={state.featureLabel}
          featureKey={state.featureKey}
        />
      )}
    </UpgradePromptContext.Provider>
  );
}

export function useUpgradePrompt(): UpgradePromptContextType {
  const ctx = useContext(UpgradePromptContext);
  if (!ctx) {
    throw new Error('useUpgradePrompt must be used within an UpgradePromptProvider');
  }
  return ctx;
}

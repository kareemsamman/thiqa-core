import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { UpgradePromptDialog, LimitResource } from './UpgradePromptDialog';
import { useAuth } from '@/hooks/useAuth';

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
  const { isAdmin, isSuperAdmin } = useAuth();

  // Workers can't upgrade plans or buy quota — only the agent admin
  // can. So when a worker hits a locked feature / quota, swap the
  // marketing dialog for a brief toast directing them to the admin.
  // This catches every call site (Sidebar lock buttons, dashboard
  // widgets, ThaqibWidget, BottomToolbar, the LIMIT_EXCEEDED error
  // handler, the global window event…) at the bottleneck so we don't
  // have to guard each individually.
  const showUpgradePrompt = useCallback((params: UpgradePromptState) => {
    if (!isAdmin && !isSuperAdmin) {
      toast.info('هذه الميزة غير متوفرة في باقتك. تواصل مع مدير الوكالة لترقية الباقة.');
      return;
    }
    setState(params);
    setOpen(true);
  }, [isAdmin, isSuperAdmin]);

  // Let non-React code (edge-function error helpers, toast actions, etc.)
  // open the dialog by dispatching a `thiqa:open-upgrade-dialog` window
  // event. The detail shape matches the UpgradePromptState.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<UpgradePromptState>).detail;
      if (detail) showUpgradePrompt(detail);
    };
    window.addEventListener('thiqa:open-upgrade-dialog', handler);
    return () => window.removeEventListener('thiqa:open-upgrade-dialog', handler);
  }, [showUpgradePrompt]);

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

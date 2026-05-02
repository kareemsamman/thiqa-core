import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Deep equality. Used to decide whether the current form state diverges from
// the loaded/baseline snapshot. Plain objects, arrays, primitives, and Date
// instances cover everything our admin forms put into state today; if a form
// ever stores something exotic (Map/Set/class instance) it should normalise
// to a plain object before passing it in.
// --------------------------------------------------------------------------
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bArr = b as unknown[];
    if (a.length !== bArr.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], bArr[i])) return false;
    }
    return true;
  }
  const ak = Object.keys(a as Record<string, unknown>);
  const bk = Object.keys(b as Record<string, unknown>);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

// --------------------------------------------------------------------------
// Provider / context
// --------------------------------------------------------------------------
type FormId = string;

interface PendingDecision {
  resolve: (discard: boolean) => void;
}

interface UnsavedChangesContextValue {
  registerForm: (id: FormId, isDirty: boolean) => void;
  unregisterForm: (id: FormId) => void;
  hasAnyDirty: () => boolean;
  /** Show modal; resolves true to discard (proceed with nav), false to stay. */
  confirmDiscard: () => Promise<boolean>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  // Registry of dirty form ids. We store as a ref + version counter so we
  // can read the latest value synchronously inside event handlers (the
  // beforeunload listener and the document click capture both need a
  // synchronous answer to "is anything dirty right now").
  const dirtyIdsRef = useRef<Set<FormId>>(new Set());
  const [, bump] = useState(0);
  const forceRender = useCallback(() => bump((n) => n + 1), []);

  const [pending, setPending] = useState<PendingDecision | null>(null);

  const registerForm = useCallback(
    (id: FormId, isDirty: boolean) => {
      const set = dirtyIdsRef.current;
      const had = set.has(id);
      if (isDirty && !had) {
        set.add(id);
        forceRender();
      } else if (!isDirty && had) {
        set.delete(id);
        forceRender();
      }
    },
    [forceRender],
  );

  const unregisterForm = useCallback(
    (id: FormId) => {
      if (dirtyIdsRef.current.delete(id)) forceRender();
    },
    [forceRender],
  );

  const hasAnyDirty = useCallback(() => dirtyIdsRef.current.size > 0, []);

  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (dirtyIdsRef.current.size === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPending({ resolve });
    });
  }, []);

  const ctxValue = useMemo<UnsavedChangesContextValue>(
    () => ({ registerForm, unregisterForm, hasAnyDirty, confirmDiscard }),
    [registerForm, unregisterForm, hasAnyDirty, confirmDiscard],
  );

  // beforeunload — refresh, close tab, type a new URL.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyIdsRef.current.size === 0) return;
      e.preventDefault();
      // Modern browsers ignore the message but require returnValue to be set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return (
    <UnsavedChangesContext.Provider value={ctxValue}>
      {children}
      <NavigationInterceptor onIntercept={confirmDiscard} hasAnyDirty={hasAnyDirty} />
      <UnsavedChangesModal
        open={pending !== null}
        onStay={() => {
          pending?.resolve(false);
          setPending(null);
        }}
        onDiscard={() => {
          pending?.resolve(true);
          setPending(null);
        }}
      />
    </UnsavedChangesContext.Provider>
  );
}

function useUnsavedChangesContext(): UnsavedChangesContextValue {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error(
      "useUnsavedChanges/useGuardedNavigate must be used inside <UnsavedChangesProvider>",
    );
  }
  return ctx;
}

// --------------------------------------------------------------------------
// Per-form hook. The single-line API the user asked for:
//   const { isDirty, markClean } = useUnsavedChanges(formState, initialState);
//
// `current` is whatever the form currently holds (state object).
// `initial` is the snapshot to compare against — typically the values
//   loaded from the server. The hook deep-equals; reference identity of
//   `initial` doesn't matter, only its contents.
// `markClean()` rebases the comparison to the current values — call it
//   inside your save's onSuccess so the form looks pristine again
//   without forcing the caller to also reset their `initial` state.
// `setDirty(boolean)` is an escape hatch when deep-equal isn't enough
//   (e.g. file uploads where the file isn't part of `current`).
// --------------------------------------------------------------------------
export function useUnsavedChanges<T>(
  current: T,
  initial: T,
  options: { id?: string; enabled?: boolean } = {},
): {
  isDirty: boolean;
  markClean: () => void;
  setDirty: (dirty: boolean) => void;
} {
  const { registerForm, unregisterForm } = useUnsavedChangesContext();
  const enabled = options.enabled !== false;

  // Stable id for the lifetime of the component. Callers can pass an
  // explicit id (e.g. "thiqa-agent-info") which makes the registry
  // human-readable but is otherwise just a key.
  const idRef = useRef<string>(
    options.id ?? `form-${Math.random().toString(36).slice(2)}`,
  );

  // Baseline = the snapshot we compare `current` against. Starts at
  // `initial`. When `initial`'s *contents* change (data refetched), we
  // adopt the new baseline. markClean() rebases to whatever `current`
  // is at the time of the call.
  const [baseline, setBaseline] = useState<T>(initial);
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    setBaseline((prev) => (deepEqual(prev, initial) ? prev : initial));
    setOverride(null);
  }, [initial]);

  const computedDirty = useMemo(
    () => !deepEqual(current, baseline),
    [current, baseline],
  );
  const isDirty = override ?? computedDirty;

  // Push the latest dirty state into the registry on every change.
  useEffect(() => {
    if (!enabled) {
      unregisterForm(idRef.current);
      return;
    }
    registerForm(idRef.current, isDirty);
  }, [isDirty, enabled, registerForm, unregisterForm]);

  // Cleanup on unmount — don't leave the form registered as dirty if
  // the user navigated away (after they confirmed the discard).
  useEffect(() => {
    const id = idRef.current;
    return () => unregisterForm(id);
  }, [unregisterForm]);

  // current is captured at click time via closure; we use a ref so
  // markClean reads the very latest value rather than whatever was
  // current when the callback was last memoised.
  const currentRef = useRef(current);
  currentRef.current = current;
  const markClean = useCallback(() => {
    setBaseline(currentRef.current);
    setOverride(null);
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    setOverride(dirty);
  }, []);

  return { isDirty, markClean, setDirty };
}

// --------------------------------------------------------------------------
// Programmatic navigation guard. Use this in place of useNavigate() when
// you have a button/handler that should respect dirty forms — e.g. the
// "back to list" arrow at the top of an edit page.
// --------------------------------------------------------------------------
export function useGuardedNavigate() {
  const navigate = useNavigate();
  const { confirmDiscard } = useUnsavedChangesContext();
  return useCallback(
    async (...args: Parameters<typeof navigate>) => {
      const ok = await confirmDiscard();
      if (!ok) return;
      // @ts-expect-error overloaded signatures
      navigate(...args);
    },
    [navigate, confirmDiscard],
  );
}

// --------------------------------------------------------------------------
// Tab-switch guard. Wrap your <Tabs onValueChange> with this when you
// want a confirmation prompt before switching tabs while dirty.
//   const onTabChange = useGuardedTabChange(setActiveTab);
//   <Tabs value={tab} onValueChange={onTabChange}>...
// --------------------------------------------------------------------------
export function useGuardedTabChange(setTab: (next: string) => void) {
  const { confirmDiscard } = useUnsavedChangesContext();
  return useCallback(
    async (next: string) => {
      const ok = await confirmDiscard();
      if (!ok) return;
      setTab(next);
    },
    [confirmDiscard, setTab],
  );
}

// --------------------------------------------------------------------------
// NavigationInterceptor — intercepts in-app link clicks and back/forward
// navigations so the modal fires for sidebar items, header links, and the
// browser back button without any per-link wiring.
// --------------------------------------------------------------------------
function NavigationInterceptor({
  onIntercept,
  hasAnyDirty,
}: {
  onIntercept: () => Promise<boolean>;
  hasAnyDirty: () => boolean;
}) {
  const navigate = useNavigate();

  // ---- Click capture for <a> elements (covers <Link> and <NavLink>) ----
  // We listen in the *capture* phase at document level so we run before
  // React's synthetic onClick on the root. If a dirty form exists and
  // the click is a same-app navigation, we cancel the click, prompt, and
  // navigate programmatically on confirm. Modifier-key clicks, target=
  // _blank, downloads, and external hrefs are left alone.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!hasAnyDirty()) return;
      if (e.defaultPrevented) return;
      if (e.button !== 0) return; // left-click only
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const path = e.composedPath();
      const anchor = path.find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement,
      );
      if (!anchor) return;
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:")) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;

      // Same-page hash jump — let it through, no nav happening.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash !== window.location.hash
      ) {
        return;
      }
      // Identical link — nothing to confirm.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash === window.location.hash
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const target = url.pathname + url.search + url.hash;
      void onIntercept().then((discard) => {
        if (discard) navigate(target);
      });
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [navigate, onIntercept, hasAnyDirty]);

  // ---- popstate (back/forward button) ----
  // popstate fires *after* the location has already moved. To intercept
  // it we re-push the entry the user just left from, prompt, and only
  // call history.back() again if they confirm. We need a ref to the
  // last URL we rendered at so we know what to push back to.
  const lastUrlRef = useRef<string>(window.location.href);
  useEffect(() => {
    const onLocationSettled = () => {
      lastUrlRef.current = window.location.href;
    };
    // Track every nav so we always know "where the user was".
    const onPop = (_e: PopStateEvent) => {
      if (!hasAnyDirty()) {
        onLocationSettled();
        return;
      }
      // Re-push the entry they left from so the URL bar matches the UI
      // while we ask the question. If they confirm discard, go back
      // again (which will fire popstate too — but by then we've already
      // marked clean, so it falls through).
      const previous = lastUrlRef.current;
      const attemptedTarget = window.location.href;
      window.history.pushState(null, "", previous);
      void onIntercept().then((discard) => {
        if (discard) {
          // Replay the back/forward navigation by pushing the target.
          window.history.pushState(null, "", attemptedTarget);
          // Tell react-router to sync to the new URL.
          navigate(
            new URL(attemptedTarget).pathname +
              new URL(attemptedTarget).search +
              new URL(attemptedTarget).hash,
            { replace: true },
          );
          lastUrlRef.current = attemptedTarget;
        }
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [navigate, onIntercept, hasAnyDirty]);

  // Keep lastUrlRef in sync on every render — covers Link/programmatic
  // navigations (which don't fire popstate). pushState already happened
  // by the time we re-render under the new path.
  useEffect(() => {
    lastUrlRef.current = window.location.href;
  });

  return null;
}

// --------------------------------------------------------------------------
// Modal
// --------------------------------------------------------------------------
function UnsavedChangesModal({
  open,
  onStay,
  onDiscard,
}: {
  open: boolean;
  onStay: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>توجد تغييرات غير محفوظة</AlertDialogTitle>
          <AlertDialogDescription>
            لديك تعديلات لم يتم حفظها. هل تريد تجاهلها والمغادرة؟
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onStay}>البقاء في الصفحة</AlertDialogCancel>
          <AlertDialogAction
            onClick={onDiscard}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            تجاهل والمغادرة
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --------------------------------------------------------------------------
// Tiny visual indicator for "you have unsaved changes". Drop it next to
// the Save button.
// --------------------------------------------------------------------------
export function UnsavedChangesIndicator({
  isDirty,
  className,
  text = "تغييرات غير محفوظة",
}: {
  isDirty: boolean;
  className?: string;
  text?: string;
}) {
  if (!isDirty) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
      {text}
    </span>
  );
}

// --------------------------------------------------------------------------
// Optional convenience: a Save button that auto-disables when the form
// is clean. Callers can keep using <Button> directly; this is just a
// shortcut for the common case.
// --------------------------------------------------------------------------
export function SaveButton({
  isDirty,
  saving,
  onClick,
  children,
  disabled,
  className,
  ...rest
}: React.ComponentProps<typeof Button> & {
  isDirty: boolean;
  saving?: boolean;
}) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || saving || !isDirty}
      className={className}
      {...rest}
    >
      {children}
    </Button>
  );
}

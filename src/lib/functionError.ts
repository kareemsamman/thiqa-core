/**
 * Helpers for surfacing nice error messages from Supabase edge functions.
 *
 * `supabase.functions.invoke(...)` rejects with a `FunctionsHttpError` on any
 * non-2xx response, but its `.message` is the generic string
 * "Edge Function returned a non-2xx status code". The actual JSON body lives
 * on `.context` (a Response). Use these helpers to pull the real Arabic
 * error out before showing it to the user.
 */

interface ParsedFunctionError {
  /** Human-readable Arabic message to display in a toast. */
  message: string;
  /** Machine-readable code set by the edge function (e.g. "sms_limit_reached"). */
  code?: string;
  /** Parsed JSON body, if any. */
  payload?: Record<string, unknown>;
  /** HTTP status if available. */
  status?: number;
}

/** Pull a JSON `error` / `message` field out of a Supabase edge function error. */
export async function parseFunctionError(rawError: unknown): Promise<ParsedFunctionError> {
  const fallback: ParsedFunctionError = { message: "حدث خطأ غير متوقع" };

  if (!(rawError instanceof Error)) {
    return fallback;
  }

  const response = (rawError as Error & { context?: Response }).context;
  if (response && typeof response.json === "function") {
    try {
      const payload = await response.clone().json();
      const message =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message) ||
        undefined;
      if (message) {
        return {
          message,
          code: typeof payload?.error_code === "string" ? payload.error_code : undefined,
          payload,
          status: response.status,
        };
      }
    } catch {
      // Response body wasn't JSON — fall through.
    }
  }

  // Some errors embed the JSON payload inside the Error.message string itself.
  const match = rawError.message.match(/\{.*\}$/);
  if (match) {
    try {
      const payload = JSON.parse(match[0]);
      const message =
        (typeof payload?.error === "string" && payload.error) ||
        (typeof payload?.message === "string" && payload.message);
      if (message) {
        return {
          message,
          code: typeof payload?.error_code === "string" ? payload.error_code : undefined,
          payload,
          status: response?.status,
        };
      }
    } catch {
      // ignore
    }
  }

  return { message: rawError.message || fallback.message, status: response?.status };
}

/** Shorthand when the caller only wants the Arabic string. */
export async function extractFunctionErrorMessage(rawError: unknown): Promise<string> {
  const parsed = await parseFunctionError(rawError);
  return parsed.message;
}

/**
 * True if the parsed error represents a usage-quota-reached response that the
 * agent can resolve by purchasing more quota.
 */
export function isQuotaReachedError(parsed: ParsedFunctionError): {
  quotaReached: boolean;
  usageType: "sms" | "ai_chat" | null;
} {
  const code = parsed.code;
  if (
    code === "sms_limit_reached" ||
    code === "sms_limit_insufficient"
  ) {
    return { quotaReached: true, usageType: "sms" };
  }
  if (code === "ai_limit_reached") {
    return { quotaReached: true, usageType: "ai_chat" };
  }
  return { quotaReached: false, usageType: null };
}

/**
 * Ask the globally-mounted quota dialog host to open for the given usage type.
 * Use as the `action.onClick` on a toast, or standalone.
 */
export function openQuotaDialog(usageType: "sms" | "ai_chat"): void {
  window.dispatchEvent(
    new CustomEvent("thiqa:open-quota-dialog", { detail: { type: usageType } }),
  );
}

/**
 * Parse an edge-function error and show a sonner toast with the Arabic
 * message. When the error is a usage-quota-reached response, the toast
 * gets an action button that opens the AddQuotaDialog so the agent can
 * resolve the block without leaving the page.
 *
 * Callers should prefer this over manually calling
 * `toast.error(await extractFunctionErrorMessage(err))` so quota errors
 * surface the purchase flow consistently everywhere.
 */
export async function toastFunctionError(
  rawError: unknown,
  fallback?: string,
): Promise<ParsedFunctionError> {
  // Lazy import keeps the helper free of a hard dep on sonner's runtime
  // when used server-side (Vite tree-shakes this fine in client bundles).
  const { toast } = await import("sonner");
  const parsed = await parseFunctionError(rawError);
  const { quotaReached, usageType } = isQuotaReachedError(parsed);

  const description = parsed.message || fallback || "حدث خطأ غير متوقع";

  if (quotaReached && usageType) {
    toast.error(description, {
      duration: 12000,
      action: {
        label: "شراء رصيد إضافي",
        onClick: () => openQuotaDialog(usageType),
      },
    });
  } else {
    toast.error(description);
  }

  return parsed;
}

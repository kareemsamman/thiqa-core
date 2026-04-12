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

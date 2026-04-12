import { useEffect, useState } from "react";
import { AddQuotaDialog, type OverageUsageType } from "./AddQuotaDialog";

/**
 * Mounted once at the app root. Listens for a custom window event so any
 * SMS/AI caller can ask the app to open the quota purchase dialog without
 * having to import the dialog component or wire up React state itself.
 *
 * Dispatch with:
 *   window.dispatchEvent(
 *     new CustomEvent("thiqa:open-quota-dialog", { detail: { type: "sms" } })
 *   );
 */
export function GlobalQuotaDialogHost() {
  const [type, setType] = useState<OverageUsageType | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: OverageUsageType } | undefined;
      if (detail?.type === "sms" || detail?.type === "ai_chat") {
        setType(detail.type);
      }
    };
    window.addEventListener("thiqa:open-quota-dialog", handler);
    return () => window.removeEventListener("thiqa:open-quota-dialog", handler);
  }, []);

  if (!type) return null;

  return (
    <AddQuotaDialog
      open={!!type}
      onOpenChange={(open) => {
        if (!open) setType(null);
      }}
      usageType={type}
    />
  );
}

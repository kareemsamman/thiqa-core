import { Badge } from "@/components/ui/badge";

// Centralized Arabic labels for plans and subscription statuses used
// across every Thiqa admin surface. Falls back to the raw key when the
// plan came from outside our known set so we never display an empty
// badge.

export const PLAN_LABEL_AR: Record<string, string> = {
  free_trial: "تجريبي",
  trial: "تجريبي",
  basic: "أساسي",
  pro: "متقدم",
  ultimate: "أعلى",
};

export const STATUS_LABEL_AR: Record<string, string> = {
  active: "فعال",
  trial: "تجريبي",
  expired: "منتهي",
  suspended: "معلّق",
  paused: "متوقف",
  cancelled: "ملغى",
};

export function planLabel(plan: string | null | undefined): string {
  if (!plan) return "—";
  return PLAN_LABEL_AR[plan] ?? plan;
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABEL_AR[status] ?? status;
}

interface BadgeOpts {
  className?: string;
}

export function PlanBadge({ plan, className }: { plan: string | null | undefined } & BadgeOpts) {
  // Pro / Ultimate get the filled primary look so they read as the
  // higher tiers at a glance; Basic / trial stay as outline pills.
  const k = plan ?? "";
  if (k === "pro" || k === "ultimate") {
    return <Badge className={`bg-primary ${className ?? ""}`}>{planLabel(k)}</Badge>;
  }
  return <Badge variant="outline" className={className}>{planLabel(k)}</Badge>;
}

export function StatusBadge({ status, className }: { status: string | null | undefined } & BadgeOpts) {
  const k = status ?? "";
  const label = statusLabel(k);
  if (k === "active") return <Badge className={`bg-green-600 ${className ?? ""}`}>{label}</Badge>;
  if (k === "trial") return <Badge className={`bg-amber-500 ${className ?? ""}`}>{label}</Badge>;
  if (k === "suspended" || k === "paused") return <Badge variant="destructive" className={className}>{label}</Badge>;
  return <Badge variant="secondary" className={className}>{label}</Badge>;
}

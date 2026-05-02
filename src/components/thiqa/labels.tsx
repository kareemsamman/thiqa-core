import { Badge } from "@/components/ui/badge";

// Centralized Arabic labels for plans and subscription statuses used
// across every Thiqa admin surface. Falls back to the raw key when the
// plan came from outside our known set so we never display an empty
// badge.

// Canonical Arabic names mirror the subscription_plans seed
// (supabase/migrations/20260422000000_pricing_packages_foundation.sql).
// Keep in lockstep so admin labels match the names users see in the
// pricing/subscription pages.
//   entry        → الأساس
//   basic        → البيسك
//   professional → المحترف
//   ultimate     → الشامل
// `pro` is the legacy key that was renamed to `professional`; it maps
// to the same label so historical agents still display correctly.
export const PLAN_LABEL_AR: Record<string, string> = {
  free_trial: "تجريبي",
  trial: "تجريبي",
  entry: "الأساس",
  basic: "البيسك",
  pro: "المحترف",
  professional: "المحترف",
  ultimate: "الشامل",
};

export const STATUS_LABEL_AR: Record<string, string> = {
  active: "فعال",
  trial: "تجريبي",
  expired: "منتهي",
  suspended: "معلّق",
  paused: "متوقف",
  cancelled: "ملغى",
};

export function planLabel(plan: string | null | undefined, displayName?: string | null): string {
  if (!plan) return "—";
  // Prefer an explicit name passed in by the caller (typically the
  // subscription_plans.name_ar for plans created by Thiqa admin that
  // aren't in the seeded set). Fall back to our static dictionary,
  // then the raw key as a last resort.
  if (displayName && displayName.trim()) return displayName;
  return PLAN_LABEL_AR[plan] ?? plan;
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return STATUS_LABEL_AR[status] ?? status;
}

interface BadgeOpts {
  className?: string;
}

export function PlanBadge({
  plan,
  displayName,
  className,
}: { plan: string | null | undefined; displayName?: string | null } & BadgeOpts) {
  // Higher tiers (Professional, Ultimate, legacy Pro) get the filled
  // primary look so they read as paid plans at a glance; Entry / Basic
  // / trial stay as outline pills.
  const k = plan ?? "";
  if (k === "pro" || k === "professional" || k === "ultimate") {
    return <Badge className={`bg-primary ${className ?? ""}`}>{planLabel(k, displayName)}</Badge>;
  }
  return <Badge variant="outline" className={className}>{planLabel(k, displayName)}</Badge>;
}

export function StatusBadge({ status, className }: { status: string | null | undefined } & BadgeOpts) {
  const k = status ?? "";
  const label = statusLabel(k);
  if (k === "active") return <Badge className={`bg-green-600 ${className ?? ""}`}>{label}</Badge>;
  if (k === "trial") return <Badge className={`bg-amber-500 ${className ?? ""}`}>{label}</Badge>;
  if (k === "suspended" || k === "paused") return <Badge variant="destructive" className={className}>{label}</Badge>;
  return <Badge variant="secondary" className={className}>{label}</Badge>;
}

// Price + cycle in one cell. Yearly customers see the actual annual
// charge (monthly_price × 12) so it's obvious at a glance they're on
// the long cycle — the cell on its own used to read like a monthly
// number whether they paid 12× that or not.
export function PriceCell({
  monthlyPrice,
  billingCycle,
}: {
  monthlyPrice: number | null | undefined;
  billingCycle: "monthly" | "yearly" | null | undefined;
}) {
  if (!monthlyPrice) return <span className="text-muted-foreground">مجاني</span>;
  if (billingCycle === "yearly") {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <span className="font-medium ltr-nums">₪{(monthlyPrice * 12).toLocaleString("en-US")}</span>
        <Badge variant="outline" className="text-[9px] bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300">
          سنوي
        </Badge>
      </div>
    );
  }
  return (
    <span className="font-medium ltr-nums">
      ₪{monthlyPrice.toLocaleString("en-US")}
      <span className="text-muted-foreground text-xs">/شهر</span>
    </span>
  );
}

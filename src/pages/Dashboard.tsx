import { useMemo, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { AgentBranchFilter } from "@/components/shared/AgentBranchFilter";

import { PeriodPills, DashboardPeriod, getPeriodRange } from "@/components/dashboard/PeriodPills";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { IncomeExpenseChart } from "@/components/dashboard/IncomeExpenseChart";
import { PoliciesDonut } from "@/components/dashboard/PoliciesDonut";
import { DebtBuckets } from "@/components/dashboard/DebtBuckets";
import { TopCompanies } from "@/components/dashboard/TopCompanies";
import { FollowUpsCard } from "@/components/dashboard/FollowUpsCard";
import { TasksMiniCard } from "@/components/dashboard/TasksMiniCard";
import { NotificationsMiniCard } from "@/components/dashboard/NotificationsMiniCard";
import { ActivityMiniCard } from "@/components/dashboard/ActivityMiniCard";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RecalcProfitsButton } from "@/components/dashboard/RecalcProfitsButton";

export default function Dashboard() {
  const { profile } = useAuth();
  const { can } = usePermissions();
  const canViewFinancial = can("view_financial");

  const [period, setPeriod] = useState<DashboardPeriod>("today");
  const range = useMemo(() => getPeriodRange(period), [period]);
  // Branch filter — global admins only (the AgentBranchFilter component
  // hides itself for branch-scoped users). null = no extra filter, the
  // user's natural scope still applies.
  const [branchId, setBranchId] = useState<string | null>(null);

  return (
    <MainLayout>
      <Header
        title="لوحة التحكم"
        subtitle={`مرحباً بك، ${profile?.full_name || "مستخدم"}`}
      />

      <div className="md:p-6 space-y-5" dir="rtl">
        {/* Global period pills + branch filter (admin-only) */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <PeriodPills value={period} onChange={setPeriod} />
            <AgentBranchFilter value={branchId} onChange={setBranchId} />
          </div>
          <p className="text-xs text-muted-foreground">
            البيانات بالفترة المحددة · الحزم تُحتسب معاملة واحدة
          </p>
        </div>

        {/* KPI row */}
        <KpiRow range={range} branchId={branchId} canViewFinancial={canViewFinancial} />

        {/* Income vs Expense + Policies donut */}
        {canViewFinancial ? (
          <div className="grid gap-4 grid-cols-1 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <IncomeExpenseChart range={range} period={period} branchId={branchId} />
            </div>
            <div>
              <PoliciesDonut range={range} branchId={branchId} />
            </div>
          </div>
        ) : (
          <PoliciesDonut range={range} branchId={branchId} />
        )}

        {/* Client debt buckets — full width */}
        {canViewFinancial && <DebtBuckets range={range} branchId={branchId} />}

        {/* Top companies + Follow-ups */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          {canViewFinancial && <TopCompanies range={range} branchId={branchId} />}
          <FollowUpsCard />
        </div>

        {/* Mini cards — tasks, notifications, activity */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
          <TasksMiniCard range={range} />
          <NotificationsMiniCard range={range} />
          <ActivityMiniCard range={range} />
        </div>

        {/* Quick actions strip */}
        <div className="rounded-2xl border bg-card/50 p-4 flex items-center justify-between gap-4 flex-wrap">
          <QuickActions />
          {canViewFinancial && <RecalcProfitsButton />}
        </div>
      </div>
    </MainLayout>
  );
}

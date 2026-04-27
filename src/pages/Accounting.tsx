import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Building2, Users, Receipt } from 'lucide-react';
import { CompaniesSection } from '@/components/accounting/CompaniesSection';
import { BrokersSection } from '@/components/accounting/BrokersSection';
import { ExpensesSection } from '@/components/accounting/ExpensesSection';
import { RecalcProfitsButton } from '@/components/dashboard/RecalcProfitsButton';
import { AgentBranchFilter } from '@/components/shared/AgentBranchFilter';

type MainTab = 'companies' | 'brokers' | 'expenses';

// Access is gated by <PermissionRoute permission="page.accounting"
// feature="accounting"> at the route level — admins bypass; workers
// need both the permission grant and the agent's plan to include
// accounting. No in-page guard needed.
export default function Accounting() {
  const [searchParams] = useSearchParams();
  const initialTab: MainTab =
    searchParams.get('tab') === 'brokers'
      ? 'brokers'
      : searchParams.get('tab') === 'expenses'
      ? 'expenses'
      : 'companies';
  const [tab, setTab] = useState<MainTab>(initialTab);
  // Page-level branch filter — applies to all three sub-tabs. Global
  // admins only; AgentBranchFilter hides itself for branch-scoped users.
  const [branchId, setBranchId] = useState<string | null>(null);
  // Settlement id passed in via ?settlement=… — sections read this
  // to scroll their corresponding row into view + highlight it.
  const settlementParam = searchParams.get('settlement');

  // If the URL changes after mount (deep link from Cheques page), keep
  // the tab in sync without forcing remount.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <MainLayout>
      <Header
        title="المحاسبة"
        subtitle="عرض موحّد لشركات التأمين والوسطاء والمصاريف"
      />

      <div className="p-3 md:p-4 space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="grid w-full max-w-md grid-cols-3">
              <TabsTrigger value="companies" className="gap-2">
                <Building2 className="h-4 w-4" />
                شركات التأمين
              </TabsTrigger>
              <TabsTrigger value="brokers" className="gap-2">
                <Users className="h-4 w-4" />
                الوسطاء
              </TabsTrigger>
              <TabsTrigger value="expenses" className="gap-2">
                <Receipt className="h-4 w-4" />
                المصاريف
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <AgentBranchFilter value={branchId} onChange={setBranchId} />
              <RecalcProfitsButton />
            </div>
          </div>

          <TabsContent value="companies" className="mt-3">
            <CompaniesSection focusSettlementId={settlementParam} branchId={branchId} />
          </TabsContent>
          <TabsContent value="brokers" className="mt-3">
            <BrokersSection focusSettlementId={settlementParam} branchId={branchId} />
          </TabsContent>
          <TabsContent value="expenses" className="mt-3">
            <ExpensesSection focusSettlementId={settlementParam} branchId={branchId} />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

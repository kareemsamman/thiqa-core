import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Building2, Users, UserRound, Wallet } from 'lucide-react';
import { CompaniesSection } from '@/components/accounting/CompaniesSection';
import { BrokersSection } from '@/components/accounting/BrokersSection';
import { OtherSection } from '@/components/accounting/OtherSection';
import { ClientsSection } from '@/components/accounting/ClientsSection';
import { RecalcProfitsButton } from '@/components/dashboard/RecalcProfitsButton';
import { AgentBranchFilter } from '@/components/shared/AgentBranchFilter';

type MainTab = 'companies' | 'brokers' | 'clients' | 'other';

// Access is gated by <PermissionRoute permission="page.accounting"
// feature="accounting"> at the route level — admins bypass; workers
// need both the permission grant and the agent's plan to include
// accounting. No in-page guard needed.
export default function Accounting() {
  const [searchParams] = useSearchParams();
  const initialTab: MainTab =
    searchParams.get('tab') === 'brokers'
      ? 'brokers'
      : searchParams.get('tab') === 'clients'
      ? 'clients'
      : searchParams.get('tab') === 'other' || searchParams.get('tab') === 'expenses'
      ? // Accept the legacy `tab=expenses` deep-link (e.g. from
        // Cheques.tsx's cheque-transferred-to-expense link) and quietly
        // route it to the new آخر tab so old bookmarks don't 404 onto
        // the default Companies tab.
        'other'
      : 'companies';
  const [tab, setTab] = useState<MainTab>(initialTab);
  // Page-level branch filter — applies to all three sub-tabs. Global
  // admins only; AgentBranchFilter hides itself for branch-scoped users.
  const [branchId, setBranchId] = useState<string | null>(null);
  // Settlement id passed in via ?settlement=… — sections read this
  // to scroll their corresponding row into view + highlight it.
  const settlementParam = searchParams.get('settlement');

  // Lazy-mount sections. Radix TabsContent renders all four children
  // by default (just hidden via CSS), so previously every section
  // fired its own data fetch on the first /accounting visit even
  // when only one tab was visible. We track which tabs have been
  // opened and only mount those — first-visit cost drops from
  // 4 sections × 1-2 queries each to just the active tab's worth.
  // Once visited, a section stays mounted so its filter/scroll state
  // survives subsequent tab switches.
  const [mountedTabs, setMountedTabs] = useState<Set<MainTab>>(() => new Set([initialTab]));
  useEffect(() => {
    setMountedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  // If the URL changes after mount (deep link from Cheques page), keep
  // the tab in sync without forcing remount.
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <MainLayout>
      <Header
        title="المحاسبة"
        subtitle="عرض موحّد لشركات التأمين والوسطاء والعملاء والجهات الأخرى"
      />

      <div className="p-3 md:p-4 space-y-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <TabsList className="grid w-full max-w-2xl grid-cols-4">
              <TabsTrigger value="companies" className="gap-2">
                <Building2 className="h-4 w-4" />
                شركات التأمين
              </TabsTrigger>
              <TabsTrigger value="brokers" className="gap-2">
                <Users className="h-4 w-4" />
                الوسطاء
              </TabsTrigger>
              <TabsTrigger value="clients" className="gap-2">
                <UserRound className="h-4 w-4" />
                العملاء
              </TabsTrigger>
              <TabsTrigger value="other" className="gap-2">
                <Wallet className="h-4 w-4" />
                آخر
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <AgentBranchFilter value={branchId} onChange={setBranchId} />
              <RecalcProfitsButton />
            </div>
          </div>

          <TabsContent value="companies" className="mt-3">
            {mountedTabs.has('companies') && (
              <CompaniesSection focusSettlementId={settlementParam} branchId={branchId} />
            )}
          </TabsContent>
          <TabsContent value="brokers" className="mt-3">
            {mountedTabs.has('brokers') && (
              <BrokersSection focusSettlementId={settlementParam} branchId={branchId} />
            )}
          </TabsContent>
          <TabsContent value="clients" className="mt-3">
            {mountedTabs.has('clients') && <ClientsSection branchId={branchId} />}
          </TabsContent>
          <TabsContent value="other" className="mt-3">
            {mountedTabs.has('other') && <OtherSection branchId={branchId} />}
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

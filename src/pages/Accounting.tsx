import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Building2, Users, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { CompaniesSection } from '@/components/accounting/CompaniesSection';
import { BrokersSection } from '@/components/accounting/BrokersSection';
import { ExpensesSection } from '@/components/accounting/ExpensesSection';

type MainTab = 'companies' | 'brokers' | 'expenses';

export default function Accounting() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<MainTab>('companies');

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <MainLayout>
      <Header
        title="المحاسبة"
        subtitle="عرض موحّد لشركات التأمين والوسطاء والمصاريف"
      />

      <div className="p-4 md:p-6 space-y-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as MainTab)}>
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

          <TabsContent value="companies" className="mt-5">
            <CompaniesSection />
          </TabsContent>
          <TabsContent value="brokers" className="mt-5">
            <BrokersSection />
          </TabsContent>
          <TabsContent value="expenses" className="mt-5">
            <ExpensesSection />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}

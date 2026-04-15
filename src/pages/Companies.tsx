import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Search, Settings, Building2, Truck, Shield, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { CompanyDrawer } from '@/components/companies/CompanyDrawer';
import { PricingRulesDrawer } from '@/components/companies/PricingRulesDrawer';
import { RoadServicePricingDrawer } from '@/components/companies/RoadServicePricingDrawer';
import { AccidentFeePricingDrawer } from '@/components/companies/AccidentFeePricingDrawer';
import type { Tables } from '@/integrations/supabase/types';

type Company = Tables<'insurance_companies'>;

const POLICY_TYPES = [
  { value: "ELZAMI", label: "إلزامي" },
  { value: "THIRD_FULL", label: "ثالث/شامل" },
  { value: "ROAD_SERVICE", label: "خدمات الطريق" },
  { value: "ACCIDENT_FEE_EXEMPTION", label: "إعفاء رسوم حادث" },
];

export default function Companies() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [pricingDrawerOpen, setPricingDrawerOpen] = useState(false);
  const [pricingCompany, setPricingCompany] = useState<Company | null>(null);
  const [roadServicePricingOpen, setRoadServicePricingOpen] = useState(false);
  const [roadServicePricingCompany, setRoadServicePricingCompany] = useState<Company | null>(null);
  const [accidentFeePricingOpen, setAccidentFeePricingOpen] = useState(false);
  const [accidentFeePricingCompany, setAccidentFeePricingCompany] = useState<Company | null>(null);

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('insurance_companies')
        .select('*')
        .order('name', { ascending: true });

      if (searchQuery) {
        query = query.or(`name.ilike.%${searchQuery}%,name_ar.ilike.%${searchQuery}%`);
      }

      // Filter by category_parent array contains
      if (typeFilter && typeFilter !== 'all') {
        query = query.contains('category_parent', [typeFilter]);
      }

      // Exclude broker-linked companies - they are managed through broker wallet
      query = query.is('broker_id', null);

      const { data, error } = await query;

      if (error) throw error;
      setCompanies(data || []);
    } catch (error) {
      console.error('Error fetching companies:', error);
      toast({
        title: 'خطأ',
        description: 'فشل في جلب شركات التأمين',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [searchQuery, typeFilter]);

  const handleAddCompany = () => {
    setSelectedCompany(null);
    setDrawerOpen(true);
  };

  const handleEditCompany = (company: Company) => {
    setSelectedCompany(company);
    setDrawerOpen(true);
  };

  const handleManagePricing = (company: Company) => {
    setPricingCompany(company);
    setPricingDrawerOpen(true);
  };

  const handleManageRoadServicePricing = (company: Company) => {
    setRoadServicePricingCompany(company);
    setRoadServicePricingOpen(true);
  };

  const handleManageAccidentFeePricing = (company: Company) => {
    setAccidentFeePricingCompany(company);
    setAccidentFeePricingOpen(true);
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setSelectedCompany(null);
  };

  const handlePricingDrawerClose = () => {
    setPricingDrawerOpen(false);
    setPricingCompany(null);
  };

  const handleSaveSuccess = () => {
    fetchCompanies();
    handleDrawerClose();
  };

  if (!isAdmin) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center h-full">
          <div className="text-center space-y-4">
            <Building2 className="h-16 w-16 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">غير مصرح</h2>
            <p className="text-muted-foreground">هذه الصفحة متاحة للمسؤولين فقط</p>
          </div>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <Header
        title="شركات التأمين"
        subtitle="إدارة شركات التأمين وقواعد التسعير"
      />

      <div className="p-6 space-y-6">
        {/* Actions Bar */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="flex flex-1 gap-4 max-w-2xl">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث عن شركة..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="جميع الأنواع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنواع</SelectItem>
                {POLICY_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAddCompany}>
            <Plus className="h-4 w-4 ml-2" />
            إضافة شركة
          </Button>
        </div>

        {/* Companies Table */}
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b bg-muted/30 px-5 py-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">شركات التأمين</h3>
            </div>
            <span className="text-xs text-muted-foreground ltr-nums">
              {loading ? '—' : `${companies.length} شركة`}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20 hover:bg-muted/20 border-border/60">
                <TableHead className="text-right font-semibold">الاسم بالعربية</TableHead>
                <TableHead className="text-right font-semibold">الاسم بالإنجليزية</TableHead>
                <TableHead className="text-right font-semibold">نوع التأمين</TableHead>
                <TableHead className="text-right font-semibold">العمولة</TableHead>
                <TableHead className="text-right font-semibold">الحالة</TableHead>
                <TableHead className="text-right font-semibold">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-border/40">
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : companies.length === 0 ? (
              <TableRow>
                  <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                    لا توجد شركات تأمين
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className="cursor-pointer border-border/40 transition-colors hover:bg-muted/40"
                    onClick={() => handleEditCompany(company)}
                  >
                    <TableCell className="font-semibold">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-1 rounded-full bg-primary/60" />
                        {company.name_ar || '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{company.name}</TableCell>
                    <TableCell>
                      {company.category_parent && company.category_parent.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {company.category_parent.map((type) => (
                            <Badge key={type} variant="outline" className="text-xs">
                              {POLICY_TYPES.find(t => t.value === type)?.label || type}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">غير محدد</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {company.category_parent?.includes('ELZAMI') ? (
                        <span className={`font-medium ${(company.elzami_commission || 0) < 0 ? 'text-destructive' : 'text-success'}`}>
                          ₪{(company.elzami_commission || 0).toLocaleString('en-US')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={company.active ? 'default' : 'secondary'}>
                        {company.active ? 'نشط' : 'غير نشط'}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 flex-nowrap">
                        <Button
                          variant="default"
                          size="icon"
                          className="h-8 w-8"
                          title="المحفظة"
                          onClick={() => navigate(`/companies/${company.id}/wallet`)}
                        >
                          <Wallet className="h-4 w-4" />
                          <span className="sr-only">المحفظة</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="التسعير"
                          onClick={() => handleManagePricing(company)}
                        >
                          <Settings className="h-4 w-4" />
                          <span className="sr-only">التسعير</span>
                        </Button>
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="خدمات الطريق"
                            onClick={() => handleManageRoadServicePricing(company)}
                          >
                            <Truck className="h-4 w-4" />
                            <span className="sr-only">خدمات الطريق</span>
                          </Button>
                        )}
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            title="إعفاء الحادث"
                            onClick={() => handleManageAccidentFeePricing(company)}
                          >
                            <Shield className="h-4 w-4" />
                            <span className="sr-only">إعفاء الحادث</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Company Drawer */}
      <CompanyDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        company={selectedCompany}
        onSuccess={handleSaveSuccess}
      />

      {/* Pricing Rules Drawer */}
      <PricingRulesDrawer
        open={pricingDrawerOpen}
        onClose={handlePricingDrawerClose}
        company={pricingCompany}
      />

      {/* Road Service Pricing Drawer */}
      <RoadServicePricingDrawer
        open={roadServicePricingOpen}
        onOpenChange={setRoadServicePricingOpen}
        company={roadServicePricingCompany}
      />

      {/* Accident Fee Pricing Drawer */}
      <AccidentFeePricingDrawer
        open={accidentFeePricingOpen}
        onOpenChange={setAccidentFeePricingOpen}
        company={accidentFeePricingCompany}
      />
    </MainLayout>
  );
}

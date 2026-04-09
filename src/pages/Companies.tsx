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
import { Plus, Search, Settings, Building2, Truck, Shield, Wallet, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { CompanyDrawer } from '@/components/companies/CompanyDrawer';
import { PricingRulesDrawer } from '@/components/companies/PricingRulesDrawer';
import { RoadServicePricingDrawer } from '@/components/companies/RoadServicePricingDrawer';
import { AccidentFeePricingDrawer } from '@/components/companies/AccidentFeePricingDrawer';
import { AccidentTemplateDrawer } from '@/components/companies/AccidentTemplateDrawer';
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
  const [accidentTemplateOpen, setAccidentTemplateOpen] = useState(false);
  const [accidentTemplateCompany, setAccidentTemplateCompany] = useState<Company | null>(null);

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

  const handleManageAccidentTemplate = (company: Company) => {
    setAccidentTemplateCompany(company);
    setAccidentTemplateOpen(true);
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
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الاسم بالعربية</TableHead>
                <TableHead className="text-right">الاسم بالإنجليزية</TableHead>
                <TableHead className="text-right">نوع التأمين</TableHead>
                <TableHead className="text-right">العمولة</TableHead>
                <TableHead className="text-right">الحالة</TableHead>
                <TableHead className="text-right">الإجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
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
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    لا توجد شركات تأمين
                  </TableCell>
                </TableRow>
              ) : (
                companies.map((company) => (
                  <TableRow
                    key={company.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleEditCompany(company)}
                  >
                    <TableCell className="font-medium">
                      {company.name_ar || '-'}
                    </TableCell>
                    <TableCell>{company.name}</TableCell>
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
                    <TableCell>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/companies/${company.id}/wallet`);
                          }}
                        >
                          <Wallet className="h-4 w-4 ml-2" />
                          المحفظة
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleManagePricing(company);
                          }}
                        >
                          <Settings className="h-4 w-4 ml-2" />
                          التسعير
                        </Button>
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageRoadServicePricing(company);
                            }}
                          >
                            <Truck className="h-4 w-4 ml-2" />
                            خدمات الطريق
                          </Button>
                        )}
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageAccidentFeePricing(company);
                            }}
                          >
                            <Shield className="h-4 w-4 ml-2" />
                            إعفاء الحادث
                          </Button>
                        )}
                        {(company.category_parent?.includes('THIRD_FULL') || 
                          company.category_parent?.includes('ROAD_SERVICE')) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-orange-600 hover:text-orange-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleManageAccidentTemplate(company);
                            }}
                          >
                            <AlertTriangle className="h-4 w-4 ml-2" />
                            قالب البلاغ
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

      {/* Accident Template Drawer */}
      <AccidentTemplateDrawer
        open={accidentTemplateOpen}
        onOpenChange={setAccidentTemplateOpen}
        company={accidentTemplateCompany}
      />
    </MainLayout>
  );
}

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MainLayout } from '@/components/layout/MainLayout';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
import { Plus, Search, Settings, Building2, Truck, Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
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
  // Access is gated by <PermissionRoute permission="page.companies"> at
  // the route level — admins bypass automatically, workers need the
  // permission granted from the editor. No in-page guard needed.
  const queryClient = useQueryClient();
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

  // Debounce the search box so typing doesn't fire a network call
  // per keystroke. Before, every character triggered a fresh fetch
  // (the useEffect was keyed on `searchQuery` directly), so typing
  // "ليفل" issued four sequential fetches that the UI then had to
  // reconcile — visible as a stutter on slower connections.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fetch everything once on mount, then filter / search client-side.
  // The insurance_companies table is small (tens of rows per agent),
  // so pulling the full active set is cheaper than a per-keystroke
  // network round-trip — and gives instant filter response.
  const { data: allCompanies = [], isLoading: loading } = useQuery({
    queryKey: ['companies-list'],
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase
        .from('insurance_companies')
        .select('*')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Company[];
    },
    staleTime: 5 * 60 * 1000, // 5 min — list changes rarely
  });

  // Apply search + type filter in memory. Recomputes whenever the
  // user types but never re-hits the network.
  const companies = useMemo(() => {
    let rows = allCompanies;
    if (debouncedSearch) {
      const needle = debouncedSearch.toLowerCase();
      rows = rows.filter(
        (c) =>
          (c.name?.toLowerCase().includes(needle)) ||
          (c.name_ar?.toLowerCase().includes(needle)),
      );
    }
    if (typeFilter && typeFilter !== 'all') {
      rows = rows.filter((c) =>
        (c.category_parent ?? []).includes(typeFilter as any),
      );
    }
    return rows;
  }, [allCompanies, debouncedSearch, typeFilter]);

  const fetchCompanies = () => {
    // Save/edit handlers call this to refresh — invalidate the
    // shared queryKey so the next consumer (or this page) refetches.
    queryClient.invalidateQueries({ queryKey: ['companies-list'] });
  };

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

  return (
    <MainLayout>
      <Header
        title="الشركات"
        subtitle="إدارة شركات التأمين وقواعد التسعير"
      />

      <div className="md:p-6 space-y-6">
        {/* Actions Bar. Mobile: stacks vertically with full-width
            controls and a full-width primary CTA at the bottom. From
            sm+, falls back to the original single-row layout with
            search/filter on the right and the add button on the left. */}
        <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <div className="flex items-center gap-2 sm:flex-1 sm:max-w-2xl">
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
              <SelectTrigger className="w-32 sm:w-48 shrink-0">
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
          <Button size="sm" onClick={handleAddCompany} className="gap-2 w-full sm:w-auto">
            <Plus className="h-4 w-4" />
            إضافة شركة
          </Button>
        </div>

        {/* Mobile card list — replaces the table on phones where 6
            columns of company data don't fit. Each company is its own
            tappable card with status, names, type pills, commission,
            and inline action buttons. */}
        <div className="md:hidden space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Card key={i} className="p-4 space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-6 w-32" />
              </Card>
            ))
          ) : companies.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              لا توجد شركات تأمين
            </Card>
          ) : (
            companies.map((company) => (
              <Card
                key={company.id}
                className="p-4 cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => handleEditCompany(company)}
              >
                {/* Header: names + status */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <div className="h-8 w-1 rounded-full bg-primary/60 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-base leading-tight truncate">{company.name_ar || company.name || '-'}</h3>
                    </div>
                  </div>
                  <Badge variant={company.active ? 'default' : 'secondary'} className="shrink-0">
                    {company.active ? 'نشط' : 'غير نشط'}
                  </Badge>
                </div>

                {/* Type pills */}
                {company.category_parent && company.category_parent.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {company.category_parent.map((type) => (
                      <Badge key={type} variant="outline" className="text-xs">
                        {POLICY_TYPES.find(t => t.value === type)?.label || type}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Commission (ELZAMI only) */}
                {company.category_parent?.includes('ELZAMI') && (
                  <div className="flex items-center justify-between text-sm pt-2 border-t mb-3">
                    <span className="text-muted-foreground">العمولة</span>
                    <span className={`font-semibold ltr-nums ${(company.elzami_commission || 0) < 0 ? 'text-destructive' : 'text-success'}`}>
                      ₪{(company.elzami_commission || 0).toLocaleString('en-US')}
                    </span>
                  </div>
                )}

                {/* Actions — flex-1 each so they share the row evenly. */}
                <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 min-w-[120px] gap-1.5 text-xs h-9"
                    onClick={() => handleManagePricing(company)}
                  >
                    <Settings className="h-3.5 w-3.5" />
                    قواعد التسعير
                  </Button>
                  {company.category_parent?.includes('ROAD_SERVICE') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 min-w-[120px] gap-1.5 text-xs h-9"
                      onClick={() => handleManageRoadServicePricing(company)}
                    >
                      <Truck className="h-3.5 w-3.5" />
                      خدمات الطريق
                    </Button>
                  )}
                  {company.category_parent?.includes('ROAD_SERVICE') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 min-w-[120px] gap-1.5 text-xs h-9"
                      onClick={() => handleManageAccidentFeePricing(company)}
                    >
                      <Shield className="h-3.5 w-3.5" />
                      إعفاء الحادث
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Companies Table — desktop only. Mobile uses the card list
            above instead since a 6-column table doesn't fit on phones. */}
        <div className="hidden md:block overflow-hidden rounded-lg border bg-card shadow-sm">
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
                <TableHead className="text-right font-semibold">اسم الشركة</TableHead>
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
                    <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : companies.length === 0 ? (
              <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-muted-foreground">
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
                        {company.name_ar || company.name || '-'}
                      </div>
                    </TableCell>
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
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => handleManagePricing(company)}
                        >
                          <Settings className="h-3.5 w-3.5" />
                          قواعد التسعير
                        </Button>
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => handleManageRoadServicePricing(company)}
                          >
                            <Truck className="h-3.5 w-3.5" />
                            خدمات الطريق
                          </Button>
                        )}
                        {company.category_parent?.includes('ROAD_SERVICE') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => handleManageAccidentFeePricing(company)}
                          >
                            <Shield className="h-3.5 w-3.5" />
                            إعفاء الحادث
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

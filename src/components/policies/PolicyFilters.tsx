import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Filter, X, Calendar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useBranches } from "@/hooks/useBranches";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths, format } from "date-fns";

interface PolicyFiltersProps {
  onFiltersChange: (filters: PolicyFilterValues) => void;
  filters: PolicyFilterValues;
}

export interface PolicyFilterValues {
  policyType: string;
  companyId: string;
  status: string;
  brokerId: string;
  creatorId: string;
  branchId: string;
  // Date filters
  datePreset: 'all' | 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom';
  dateFrom: string;
  dateTo: string;
  year: string;
}

const POLICY_TYPES = [
  { value: "ELZAMI", label: "إلزامي" },
  { value: "THIRD_FULL", label: "ثالث/شامل" },
  { value: "ROAD_SERVICE", label: "خدمات الطريق" },
  { value: "ACCIDENT_FEE_EXEMPTION", label: "إعفاء رسوم حادث" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "نشطة" },
  { value: "expired", label: "منتهية" },
  { value: "cancelled", label: "ملغاة" },
  { value: "transferred", label: "محوّلة" },
];

const DATE_PRESETS = [
  { value: "all", label: "كل الفترات" },
  { value: "today", label: "اليوم" },
  { value: "this_week", label: "هذا الأسبوع" },
  { value: "this_month", label: "هذا الشهر" },
  { value: "last_month", label: "الشهر الماضي" },
  { value: "custom", label: "فترة مخصصة" },
];

// Generate years from 2020 to current year + 1
const generateYears = () => {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= 2020; y--) {
    years.push({ value: y.toString(), label: y.toString() });
  }
  return years;
};

export function PolicyFilters({ onFiltersChange, filters }: PolicyFiltersProps) {
  const { isAdmin } = useAuth();
  const { branches } = useBranches();
  const [open, setOpen] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string; name_ar: string | null }[]>([]);
  const [brokers, setBrokers] = useState<{ id: string; name: string }[]>([]);
  const [creators, setCreators] = useState<{ id: string; name: string }[]>([]);
  const [localFilters, setLocalFilters] = useState<PolicyFilterValues>(filters);
  const years = generateYears();

  useEffect(() => {
    const fetchData = async () => {
      const [companiesRes, brokersRes, creatorsRes] = await Promise.all([
        supabase.from('insurance_companies').select('id, name, name_ar').eq('active', true).order('name'),
        supabase.from('brokers').select('id, name').order('name'),
        supabase.from('profiles').select('id, full_name, email').eq('status', 'active'),
      ]);
      
      if (companiesRes.data) setCompanies(companiesRes.data);
      if (brokersRes.data) setBrokers(brokersRes.data);
      if (creatorsRes.data) setCreators(creatorsRes.data.map(p => ({ id: p.id, name: p.full_name || p.email })));
    };
    fetchData();
  }, []);

  // Count active filters (excluding date presets when they're 'all')
  const countActiveFilters = () => {
    let count = 0;
    if (filters.policyType !== 'all') count++;
    if (filters.companyId !== 'all') count++;
    if (filters.status !== 'all') count++;
    if (filters.brokerId !== 'all') count++;
    if (filters.creatorId !== 'all') count++;
    if (filters.branchId !== 'all') count++;
    if (filters.datePreset !== 'all') count++;
    if (filters.year !== 'all') count++;
    return count;
  };
  
  const activeFiltersCount = countActiveFilters();

  // Handle date preset changes
  const handleDatePresetChange = (preset: string) => {
    const today = new Date();
    let dateFrom = '';
    let dateTo = '';
    
    switch (preset) {
      case 'today':
        dateFrom = format(today, 'yyyy-MM-dd');
        dateTo = format(today, 'yyyy-MM-dd');
        break;
      case 'this_week':
        dateFrom = format(startOfWeek(today, { weekStartsOn: 0 }), 'yyyy-MM-dd');
        dateTo = format(endOfWeek(today, { weekStartsOn: 0 }), 'yyyy-MM-dd');
        break;
      case 'this_month':
        dateFrom = format(startOfMonth(today), 'yyyy-MM-dd');
        dateTo = format(endOfMonth(today), 'yyyy-MM-dd');
        break;
      case 'last_month':
        const lastMonth = subMonths(today, 1);
        dateFrom = format(startOfMonth(lastMonth), 'yyyy-MM-dd');
        dateTo = format(endOfMonth(lastMonth), 'yyyy-MM-dd');
        break;
      case 'custom':
        // Keep existing dates when switching to custom
        dateFrom = localFilters.dateFrom;
        dateTo = localFilters.dateTo;
        break;
      default:
        // 'all' - clear dates
        dateFrom = '';
        dateTo = '';
    }
    
    setLocalFilters(f => ({ 
      ...f, 
      datePreset: preset as PolicyFilterValues['datePreset'],
      dateFrom,
      dateTo,
      year: 'all' // Clear year when using preset
    }));
  };

  // Handle year change
  const handleYearChange = (year: string) => {
    if (year === 'all') {
      setLocalFilters(f => ({ ...f, year: 'all', datePreset: 'all', dateFrom: '', dateTo: '' }));
    } else {
      setLocalFilters(f => ({ 
        ...f, 
        year, 
        datePreset: 'all', 
        dateFrom: `${year}-01-01`, 
        dateTo: `${year}-12-31` 
      }));
    }
  };

  const handleApply = () => {
    onFiltersChange(localFilters);
    setOpen(false);
  };

  const handleClear = () => {
    const cleared: PolicyFilterValues = {
      policyType: 'all',
      companyId: 'all',
      status: 'all',
      brokerId: 'all',
      creatorId: 'all',
      branchId: 'all',
      datePreset: 'all',
      dateFrom: '',
      dateTo: '',
      year: 'all',
    };
    setLocalFilters(cleared);
    onFiltersChange(cleared);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <Filter className="h-4 w-4 ml-1" />
          <span className="hidden sm:inline">فلترة متقدمة</span>
          <span className="sm:hidden">فلترة</span>
          {activeFiltersCount > 0 && (
            <Badge className="absolute -top-2 -left-2 h-5 w-5 p-0 flex items-center justify-center text-xs">
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-4" align="end" dir="rtl">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-right">فلترة متقدمة</h4>
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-muted-foreground h-8">
              <X className="h-3 w-3 ml-1" />
              مسح الكل
            </Button>
          </div>

          {/* Date Filters Section */}
          <div className="p-3 bg-muted/30 rounded-lg space-y-3 border">
            <div className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
              <Calendar className="h-4 w-4" />
              فلترة بالتاريخ
            </div>
            
            {/* Date Preset */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-right block text-xs">الفترة</Label>
                <Select 
                  value={localFilters.datePreset} 
                  onValueChange={handleDatePresetChange}
                >
                  <SelectTrigger className="h-9 text-right text-sm">
                    <SelectValue placeholder="اختر الفترة" />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_PRESETS.map(p => (
                      <SelectItem key={p.value} value={p.value} className="text-right">{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Year Filter */}
              <div className="space-y-1.5">
                <Label className="text-right block text-xs">السنة</Label>
                <Select 
                  value={localFilters.year} 
                  onValueChange={handleYearChange}
                >
                  <SelectTrigger className="h-9 text-right text-sm">
                    <SelectValue placeholder="كل السنوات" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-right">كل السنوات</SelectItem>
                    {years.map(y => (
                      <SelectItem key={y.value} value={y.value} className="text-right">{y.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Custom Date Range */}
            {localFilters.datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-right block text-xs">من تاريخ</Label>
                  <ArabicDatePicker
                    value={localFilters.dateFrom || undefined}
                    onChange={(date) => setLocalFilters(f => ({ ...f, dateFrom: date || '' }))}
                    placeholder="من تاريخ"
                    compact
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-right block text-xs">إلى تاريخ</Label>
                  <ArabicDatePicker
                    value={localFilters.dateTo || undefined}
                    onChange={(date) => setLocalFilters(f => ({ ...f, dateTo: date || '' }))}
                    placeholder="إلى تاريخ"
                    compact
                  />
                </div>
              </div>
            )}
          </div>

          {/* Policy Type */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">نوع الوثيقة</Label>
            <Select value={localFilters.policyType} onValueChange={v => setLocalFilters(f => ({ ...f, policyType: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {POLICY_TYPES.map(type => (
                  <SelectItem key={type.value} value={type.value} className="text-right">{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Company */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">شركة التأمين</Label>
            <Select value={localFilters.companyId} onValueChange={v => setLocalFilters(f => ({ ...f, companyId: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-right">{c.name_ar || c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">الحالة</Label>
            <Select value={localFilters.status} onValueChange={v => setLocalFilters(f => ({ ...f, status: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value} className="text-right">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Broker */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">الوسيط</Label>
            <Select value={localFilters.brokerId} onValueChange={v => setLocalFilters(f => ({ ...f, brokerId: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {brokers.map(b => (
                  <SelectItem key={b.id} value={b.id} className="text-right">{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Creator */}
          <div className="space-y-1.5">
            <Label className="text-right block text-sm">أنشئ بواسطة</Label>
            <Select value={localFilters.creatorId} onValueChange={v => setLocalFilters(f => ({ ...f, creatorId: v }))}>
              <SelectTrigger className="h-9 text-right">
                <SelectValue placeholder="الكل" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-right">الكل</SelectItem>
                {creators.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-right">{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Branch - Only for admins */}
          {isAdmin && (
            <div className="space-y-1.5">
              <Label className="text-right block text-sm">الفرع</Label>
              <Select value={localFilters.branchId} onValueChange={v => setLocalFilters(f => ({ ...f, branchId: v }))}>
                <SelectTrigger className="h-9 text-right">
                  <SelectValue placeholder="الكل" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-right">الكل</SelectItem>
                  {branches.map(b => (
                    <SelectItem key={b.id} value={b.id} className="text-right">{b.name_ar || b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button className="w-full" onClick={handleApply}>
            تطبيق الفلترة
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
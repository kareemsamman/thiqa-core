import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Filter, X } from 'lucide-react';
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter';

export interface FilterOption {
  value: string;
  label: string;
}

export interface AccountingFiltersValue {
  dateFrom: string;
  dateTo: string;
  companies: string[];
  types: string[];
  paymentMethods: string[];
}

interface Props {
  value: AccountingFiltersValue;
  onChange: (next: AccountingFiltersValue) => void;
  companyOptions: FilterOption[];
  typeOptions: FilterOption[];
  paymentMethodOptions: FilterOption[];
  /** Hide filter sections that don't apply to the active tab. */
  show?: {
    dateRange?: boolean;
    companies?: boolean;
    types?: boolean;
    paymentMethods?: boolean;
  };
}

const ALL_SHOWN: Required<NonNullable<Props['show']>> = {
  dateRange: true,
  companies: true,
  types: true,
  paymentMethods: true,
};

export function AccountingFilters({
  value,
  onChange,
  companyOptions,
  typeOptions,
  paymentMethodOptions,
  show,
}: Props) {
  const visible = { ...ALL_SHOWN, ...(show ?? {}) };

  const activeCount =
    (value.dateFrom ? 1 : 0) +
    (value.dateTo ? 1 : 0) +
    value.companies.length +
    value.types.length +
    value.paymentMethods.length;

  const reset = () => {
    onChange({
      dateFrom: '',
      dateTo: '',
      companies: [],
      types: [],
      paymentMethods: [],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          <span>فلترة</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-xs rounded-full">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0" dir="rtl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h4 className="text-sm font-semibold">الفلاتر</h4>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
              مسح الكل
            </button>
          )}
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {visible.dateRange && (
            <div className="space-y-2">
              <Label className="text-xs">المدى الزمني</Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">من</Label>
                  <Input
                    type="date"
                    value={value.dateFrom}
                    onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">إلى</Label>
                  <Input
                    type="date"
                    value={value.dateTo}
                    onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {visible.companies && companyOptions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">شركة التأمين</Label>
              <MultiSelectFilter
                options={companyOptions}
                selected={value.companies}
                onChange={(c) => onChange({ ...value, companies: c })}
                placeholder="كل الشركات"
              />
            </div>
          )}

          {visible.types && typeOptions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">نوع التأمين</Label>
              <MultiSelectFilter
                options={typeOptions}
                selected={value.types}
                onChange={(t) => onChange({ ...value, types: t })}
                placeholder="كل الأنواع"
              />
            </div>
          )}

          {visible.paymentMethods && paymentMethodOptions.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs">طريقة الدفع</Label>
              <MultiSelectFilter
                options={paymentMethodOptions}
                selected={value.paymentMethods}
                onChange={(p) => onChange({ ...value, paymentMethods: p })}
                placeholder="كل الطرق"
              />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

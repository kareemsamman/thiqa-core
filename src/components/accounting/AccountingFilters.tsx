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
  /** First day of selected month, ISO yyyy-MM-dd. Empty = no filter. */
  dateFrom: string;
  /** Last day of selected month, ISO yyyy-MM-dd. */
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

/**
 * Convert an ISO date back to "yyyy-MM" so the native month input can
 * display the saved selection.
 */
function isoToMonthInput(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 7);
}

/**
 * Given a "yyyy-MM" value, return [first, last] day of that month in
 * ISO format. We compute the last day off the local Date constructor
 * trick (day 0 of the next month).
 */
function monthInputToRange(monthInput: string): { from: string; to: string } {
  if (!monthInput) return { from: '', to: '' };
  const [y, m] = monthInput.split('-').map(Number);
  if (!y || !m) return { from: '', to: '' };
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

export function AccountingFilters({
  value,
  onChange,
  companyOptions,
  typeOptions,
  paymentMethodOptions,
  show,
}: Props) {
  const visible = { ...ALL_SHOWN, ...(show ?? {}) };

  const monthInput = isoToMonthInput(value.dateFrom);

  const activeCount =
    (value.dateFrom ? 1 : 0) +
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

  const setMonth = (m: string) => {
    const range = monthInputToRange(m);
    onChange({ ...value, dateFrom: range.from, dateTo: range.to });
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
      <PopoverContent align="end" className="w-[340px] p-0" dir="rtl">
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
            <div className="space-y-1.5">
              <Label className="text-xs">الشهر</Label>
              <Input
                type="month"
                value={monthInput}
                onChange={(e) => setMonth(e.target.value)}
                className="h-9 text-sm"
              />
              {monthInput && (
                <button
                  type="button"
                  onClick={() => setMonth('')}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  مسح الشهر
                </button>
              )}
            </div>
          )}

          {visible.companies && companyOptions.length > 0 && (
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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

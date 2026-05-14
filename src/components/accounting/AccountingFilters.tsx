import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Filter, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter';
import { ArabicDatePicker } from '@/components/ui/arabic-date-picker';
import { ArabicMonthPicker } from './ArabicMonthPicker';
import { cn } from '@/lib/utils';

export interface FilterOption {
  value: string;
  label: string;
}

export type CounterpartyFilter = 'all' | 'broker' | 'client';

export interface AccountingFiltersValue {
  /** First day of selected range (or month), ISO yyyy-MM-dd. */
  dateFrom: string;
  /** Last day of selected range (or month), ISO yyyy-MM-dd. */
  dateTo: string;
  companies: string[];
  types: string[];
  paymentMethods: string[];
  /** Limit رows to a counterparty kind — broker vs customer. Default 'all'. */
  counterparty?: CounterpartyFilter;
}

interface Props {
  value: AccountingFiltersValue;
  onChange: (next: AccountingFiltersValue) => void;
  companyOptions: FilterOption[];
  typeOptions: FilterOption[];
  paymentMethodOptions: FilterOption[];
  show?: {
    dateRange?: boolean;
    companies?: boolean;
    types?: boolean;
    paymentMethods?: boolean;
    hideElzami?: boolean;
    counterparty?: boolean;
  };
  // Optional standalone toggle wired only on /receipts. Lives outside
  // AccountingFiltersValue because other pages (e.g. /accounting) don't
  // have the same passthrough-payment concern and shouldn't carry the
  // flag in their filter state.
  hideElzami?: boolean;
  onHideElzamiChange?: (next: boolean) => void;
}

const ALL_SHOWN: Required<NonNullable<Props['show']>> = {
  dateRange: true,
  companies: true,
  types: true,
  paymentMethods: true,
  hideElzami: false,
  counterparty: false,
};

type DateMode = 'month' | 'range';

function isoToMonthInput(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 7);
}

function monthInputToRange(monthInput: string): { from: string; to: string } {
  if (!monthInput) return { from: '', to: '' };
  const [y, m] = monthInput.split('-').map(Number);
  if (!y || !m) return { from: '', to: '' };
  const lastDay = new Date(y, m, 0).getDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

/**
 * Detect whether the current dateFrom/dateTo represent a full month
 * (so we can keep the user in "month" mode after a reload).
 */
function looksLikeFullMonth(from: string, to: string): boolean {
  if (!from || !to) return false;
  const f = from.split('-');
  const t = to.split('-');
  if (f.length !== 3 || t.length !== 3) return false;
  if (f[0] !== t[0] || f[1] !== t[1]) return false;
  if (f[2] !== '01') return false;
  const lastDay = new Date(Number(f[0]), Number(f[1]), 0).getDate();
  return Number(t[2]) === lastDay;
}

export function AccountingFilters({
  value,
  onChange,
  companyOptions,
  typeOptions,
  paymentMethodOptions,
  show,
  hideElzami,
  onHideElzamiChange,
}: Props) {
  const visible = { ...ALL_SHOWN, ...(show ?? {}) };
  const [dateMode, setDateMode] = useState<DateMode>(() =>
    looksLikeFullMonth(value.dateFrom, value.dateTo) || (!value.dateFrom && !value.dateTo)
      ? 'month'
      : 'range',
  );

  const monthInput = isoToMonthInput(value.dateFrom);

  const counterparty: CounterpartyFilter = value.counterparty ?? 'all';
  const activeCount =
    (value.dateFrom ? 1 : 0) +
    value.companies.length +
    value.types.length +
    value.paymentMethods.length +
    (visible.hideElzami && hideElzami ? 1 : 0) +
    (visible.counterparty && counterparty !== 'all' ? 1 : 0);

  const reset = () => {
    onChange({
      dateFrom: '',
      dateTo: '',
      companies: [],
      types: [],
      paymentMethods: [],
      counterparty: 'all',
    });
    if (visible.hideElzami) onHideElzamiChange?.(false);
  };

  const setMonth = (m: string) => {
    const range = monthInputToRange(m);
    onChange({ ...value, dateFrom: range.from, dateTo: range.to });
  };

  const setFrom = (v: string) => onChange({ ...value, dateFrom: v });
  const setTo = (v: string) => onChange({ ...value, dateTo: v });

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
              <div className="flex items-center justify-between">
                <Label className="text-xs">التاريخ</Label>
                <div className="inline-flex rounded-md border bg-muted p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDateMode('month')}
                    className={cn(
                      'px-2.5 py-0.5 rounded',
                      dateMode === 'month' ? 'bg-white shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    شهر
                  </button>
                  <button
                    type="button"
                    onClick={() => setDateMode('range')}
                    className={cn(
                      'px-2.5 py-0.5 rounded',
                      dateMode === 'range' ? 'bg-white shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    من / إلى
                  </button>
                </div>
              </div>

              {dateMode === 'month' ? (
                <ArabicMonthPicker value={monthInput} onChange={setMonth} />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">من</Label>
                    <ArabicDatePicker
                      value={value.dateFrom}
                      onChange={setFrom}
                      placeholder="من"
                      compact
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">إلى</Label>
                    <ArabicDatePicker
                      value={value.dateTo}
                      onChange={setTo}
                      placeholder="إلى"
                      compact
                    />
                  </div>
                </div>
              )}
              {(value.dateFrom || value.dateTo) && (
                <button
                  type="button"
                  onClick={() => onChange({ ...value, dateFrom: '', dateTo: '' })}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  مسح التاريخ
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

          {visible.counterparty && (
            <div className="space-y-1.5">
              <Label className="text-xs">المستفيد</Label>
              <div className="inline-flex rounded-md border bg-muted p-0.5 text-[12px] w-full">
                {([
                  { v: 'all', l: 'الكل' },
                  { v: 'client', l: 'عميل' },
                  { v: 'broker', l: 'وسيط' },
                ] as Array<{ v: CounterpartyFilter; l: string }>).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => onChange({ ...value, counterparty: opt.v })}
                    className={cn(
                      'flex-1 px-2.5 py-1 rounded transition-colors',
                      counterparty === opt.v ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {visible.hideElzami && (
            <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
              <Checkbox
                checked={!!hideElzami}
                onCheckedChange={(v) => onHideElzamiChange?.(v === true)}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <span className="text-xs font-medium leading-none">
                  إخفاء دفعات الإلزامي
                </span>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  يخفي الدفعات التي يساوي مبلغها سعر الإلزامي (لا يتم تحصيلها من قبل الوكالة)
                </p>
              </div>
            </label>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

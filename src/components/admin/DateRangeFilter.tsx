import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import { arDZ as ar } from "date-fns/locale";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArabicDatePicker } from "@/components/ui/arabic-date-picker";

export type FilterPeriod = "today" | "week" | "month" | "year" | "custom";

export interface DateRangeValue {
  period: FilterPeriod;
  startDate: string;
  endDate: string;
}

export const DEFAULT_DATE_RANGE: DateRangeValue = {
  period: "today",
  startDate: "",
  endDate: "",
};

/** Resolve a DateRangeValue into concrete start/end Date objects. */
export function resolveDateRange({ period, startDate, endDate }: DateRangeValue): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "week":
      return { start: startOfWeek(now, { locale: ar }), end: endOfWeek(now, { locale: ar }) };
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "year":
      return { start: startOfYear(now), end: endOfYear(now) };
    case "custom":
      return {
        start: startDate ? new Date(startDate) : subDays(now, 7),
        end: endDate ? endOfDay(new Date(endDate)) : now,
      };
    default:
      return { start: startOfDay(now), end: endOfDay(now) };
  }
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <Select
        value={value.period}
        onValueChange={(v) => onChange({ ...value, period: v as FilterPeriod })}
      >
        <SelectTrigger className="w-40">
          <SelectValue placeholder="الفترة" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">اليوم</SelectItem>
          <SelectItem value="week">هذا الأسبوع</SelectItem>
          <SelectItem value="month">هذا الشهر</SelectItem>
          <SelectItem value="year">هذه السنة</SelectItem>
          <SelectItem value="custom">تاريخ مخصص</SelectItem>
        </SelectContent>
      </Select>

      {value.period === "custom" && (
        <div className="flex gap-2 items-center">
          <ArabicDatePicker
            value={value.startDate}
            onChange={(date) => onChange({ ...value, startDate: date })}
          />
          <span className="text-muted-foreground">إلى</span>
          <ArabicDatePicker
            value={value.endDate}
            onChange={(date) => onChange({ ...value, endDate: date })}
          />
        </div>
      )}
    </div>
  );
}

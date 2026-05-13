import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** Selected year as number. 0/undefined = no selection. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Years to highlight as having activity. Anything in this list gets the
   *  active-blue ring; everything outside is greyed out and disabled. */
  availableYears: number[];
  placeholder?: string;
  className?: string;
}

export function ArabicYearPicker({
  value,
  onChange,
  availableYears,
  placeholder = 'اختر السنة',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const currentYear = today.getFullYear();
  const availableSet = new Set(availableYears);

  // Build a 12-year window around the most recent activity (or current year),
  // expanded if needed to include the selected year. Sorted desc so newest
  // years appear first in the grid — matches how the customer thinks about
  // "last year, year before…".
  const [cursorAnchor, setCursorAnchor] = useState(() => {
    return value ?? availableYears[0] ?? currentYear;
  });

  const windowEnd = cursorAnchor;
  const windowStart = windowEnd - 11;
  const years: number[] = [];
  for (let y = windowEnd; y >= windowStart; y--) years.push(y);

  const select = (year: number) => {
    onChange(year);
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-between font-normal h-9',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="inline-flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            {value ?? placeholder}
          </span>
          {value !== null && value !== 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') clear(e as unknown as React.MouseEvent);
              }}
              className="rounded-full p-0.5 hover:bg-slate-200 cursor-pointer"
              title="مسح"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start" dir="rtl">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <button
            type="button"
            onClick={() => setCursorAnchor((y) => y - 12)}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
            title="السنوات الأقدم"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">
            {windowStart} – {windowEnd}
          </span>
          <button
            type="button"
            onClick={() => setCursorAnchor((y) => y + 12)}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
            title="السنوات الأحدث"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5 p-3">
          {years.map((year) => {
            const isSelected = value === year;
            const isAvailable = availableSet.has(year);
            const isCurrent = currentYear === year;
            return (
              <button
                key={year}
                type="button"
                disabled={!isAvailable}
                onClick={() => select(year)}
                className={cn(
                  'h-9 rounded-md text-sm tabular-nums transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : isAvailable
                      ? isCurrent
                        ? 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20'
                        : 'hover:bg-slate-100 text-foreground'
                      : 'text-muted-foreground/40 cursor-not-allowed',
                )}
              >
                {year}
              </button>
            );
          })}
        </div>

        {availableYears.length > 0 && (
          <div className="flex items-center justify-between border-t px-3 py-2 text-[11px]">
            <button
              type="button"
              onClick={() => {
                const latest = availableYears[0];
                onChange(latest);
                setCursorAnchor(latest);
                setOpen(false);
              }}
              className="text-primary hover:underline"
            >
              آخر سنة فيها نشاط
            </button>
            <span className="text-muted-foreground tabular-nums">
              {availableYears.length} سنة متاحة
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

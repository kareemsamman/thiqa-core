import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

interface Props {
  /** Format yyyy-MM. Empty = no selection. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

function parse(value: string): { year: number; month: number } | null {
  if (!value) return null;
  const [y, m] = value.split('-').map(Number);
  if (!y || !m) return null;
  return { year: y, month: m };
}

function format(year: number, month: number): string {
  return `${year}-${month.toString().padStart(2, '0')}`;
}

function displayLabel(value: string, placeholder: string): string {
  const parsed = parse(value);
  if (!parsed) return placeholder;
  return `${ARABIC_MONTHS[parsed.month - 1]} ${parsed.year}`;
}

export function ArabicMonthPicker({
  value,
  onChange,
  placeholder = 'اختر الشهر',
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const parsed = parse(value);
  // Cursor year — what year the grid is showing. Starts at the
  // selected year, falling back to "today" if nothing is picked.
  const [cursorYear, setCursorYear] = useState(
    parsed?.year ?? today.getFullYear(),
  );

  const select = (month: number) => {
    onChange(format(cursorYear, month));
    setOpen(false);
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o && parsed) setCursorYear(parsed.year);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-between font-normal h-9',
            !parsed && 'text-muted-foreground',
            className,
          )}
        >
          <span className="inline-flex items-center gap-2">
            <CalendarRange className="h-4 w-4" />
            {displayLabel(value, placeholder)}
          </span>
          {parsed && (
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
        {/* Year nav */}
        <div className="flex items-center justify-between border-b px-3 py-2">
          <button
            type="button"
            onClick={() => setCursorYear((y) => y - 1)}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
            title="السنة السابقة"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold tabular-nums">{cursorYear}</span>
          <button
            type="button"
            onClick={() => setCursorYear((y) => y + 1)}
            className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-slate-100"
            title="السنة التالية"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-3 gap-1.5 p-3">
          {ARABIC_MONTHS.map((label, idx) => {
            const monthNum = idx + 1;
            const isSelected = parsed?.year === cursorYear && parsed?.month === monthNum;
            const isCurrent =
              today.getFullYear() === cursorYear && today.getMonth() + 1 === monthNum;
            return (
              <button
                key={monthNum}
                type="button"
                onClick={() => select(monthNum)}
                className={cn(
                  'h-9 rounded-md text-sm transition-colors',
                  isSelected
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : isCurrent
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'hover:bg-slate-100',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="flex items-center justify-between border-t px-3 py-2 text-[11px]">
          <button
            type="button"
            onClick={() => {
              onChange(format(today.getFullYear(), today.getMonth() + 1));
              setCursorYear(today.getFullYear());
              setOpen(false);
            }}
            className="text-primary hover:underline"
          >
            هذا الشهر
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
              onChange(format(d.getFullYear(), d.getMonth() + 1));
              setCursorYear(d.getFullYear());
              setOpen(false);
            }}
            className="text-muted-foreground hover:underline"
          >
            الشهر الماضي
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X, Search } from 'lucide-react';

import { cn } from '@/lib/utils';

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectFilterProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
  className?: string;
}

export function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder = 'الكل',
  searchable = true,
  className,
}: MultiSelectFilterProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = search.trim()
    ? options.filter((o) =>
        o.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);

  const displayLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || '1'
        : `${selected.length} مختار`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className={cn(
            'w-full justify-between font-normal h-10',
            selected.length === 0 && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{displayLabel}</span>
          <div className="flex items-center gap-1 mr-1">
            {selected.length > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-xs rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
              >
                <X className="h-3 w-3" />
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        {searchable && options.length > 5 && (
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pr-8 text-sm"
              />
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-1.5 border-b">
          <button
            className="text-xs text-primary hover:underline"
            onClick={selectAll}
          >
            تحديد الكل
          </button>
          <button
            className="text-xs text-muted-foreground hover:underline"
            onClick={clearAll}
          >
            مسح
          </button>
        </div>
        <div className="max-h-[220px] overflow-y-auto">
          <div className="p-1">
            {filtered.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                لا توجد نتائج
              </div>
            ) : (
              filtered.map((option) => (
                <label
                  key={option.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={selected.includes(option.value)}
                    onCheckedChange={() => toggle(option.value)}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

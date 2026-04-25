import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Columns3, RotateCcw } from 'lucide-react';

export interface ColumnOption {
  key: string;
  label: string;
  required?: boolean;
}

interface Props {
  columns: ColumnOption[];
  visible: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}

export function ManageColumnsDropdown({ columns, visible, onToggle, onReset }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Columns3 className="h-4 w-4" />
          <span className="hidden sm:inline">إدارة الأعمدة</span>
          <span className="text-xs text-muted-foreground">({visible.length}/{columns.length})</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-xs font-semibold">الأعمدة</DropdownMenuLabel>
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            إعادة الافتراضي
          </button>
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-[320px] overflow-y-auto py-1">
          {columns.map((col) => {
            const checked = visible.includes(col.key);
            return (
              <label
                key={col.key}
                className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md hover:bg-slate-100 cursor-pointer text-sm"
              >
                <Checkbox
                  checked={checked}
                  disabled={col.required}
                  onCheckedChange={() => onToggle(col.key)}
                />
                <span className="flex-1 truncate">{col.label}</span>
                {col.required && (
                  <span className="text-[10px] text-muted-foreground">إلزامي</span>
                )}
              </label>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

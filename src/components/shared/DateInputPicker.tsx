import { useState, useEffect } from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateInputPickerProps {
  value: Date;
  onChange: (date: Date) => void;
  className?: string;
}

export function DateInputPicker({ value, onChange, className }: DateInputPickerProps) {
  const [text, setText] = useState(format(value, "dd/MM/yyyy"));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setText(format(value, "dd/MM/yyyy"));
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setText(v);
    // Try parsing dd/MM/yyyy
    const parsed = parse(v, "dd/MM/yyyy", new Date());
    if (isValid(parsed) && v.length === 10) {
      onChange(parsed);
    }
  };

  const handleCalendarSelect = (d: Date | undefined) => {
    if (d) {
      onChange(d);
      setOpen(false);
    }
  };

  return (
    <div className={cn("flex gap-1", className)}>
      <Input
        value={text}
        onChange={handleTextChange}
        placeholder="dd/MM/yyyy"
        className="flex-1 text-sm"
        dir="ltr"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center justify-center rounded-md border border-input bg-background h-9 w-9 hover:bg-accent shrink-0">
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={value} onSelect={handleCalendarSelect} initialFocus className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

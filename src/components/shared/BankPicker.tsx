import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Building2, X } from "lucide-react";
import { BANK_OPTIONS, getBank, normalizeBankCode } from "@/lib/banks";
import { cn } from "@/lib/utils";

export interface BankPickerProps {
  /** Currently stored bank code (free-text, may or may not match the registry). */
  value: string | null | undefined;
  onChange: (code: string | null) => void;
  disabled?: boolean;
  /** Placeholder inside the trigger button when no value is selected. */
  placeholder?: string;
  /** Custom className on the trigger button wrapper. */
  className?: string;
  /** Width of the popover content. Defaults to match the trigger. */
  popoverWidthClassName?: string;
}

// Standalone bank combobox — same component used everywhere in the app
// that needs a bank dropdown. Features:
//   * Name + code search
//   * Manual free-text entry for codes not in the registry
//   * Clear button to wipe the selection
//   * Uses the same BANK_OPTIONS list from src/lib/banks.ts
//
// Drop it in anywhere — payment forms, cheque pages, settlement dialogs,
// reports filters. For the combined bank + branch cheque entry pattern
// see BankBranchPicker, which wraps this.
export function BankPicker({
  value,
  onChange,
  disabled,
  placeholder = "اختر البنك",
  className,
  popoverWidthClassName = "w-[min(420px,92vw)]",
}: BankPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const current = useMemo(() => getBank(value), [value]);

  // Surface a synthetic "manual entry" row when the user has typed a
  // numeric code that doesn't match any registry entry. Accepts 2+ digits
  // so "04" works but "4" auto-normalizes via normalizeBankCode.
  const manualOption = useMemo(() => {
    const typed = normalizeBankCode(search);
    if (!typed) return null;
    if (BANK_OPTIONS.some((b) => b.code === typed)) return null;
    if (!/^\d{2,}$/.test(typed)) return null;
    return { code: typed };
  }, [search]);

  // Filtered list — match either on numeric code or Arabic name.
  const filteredBanks = useMemo(() => {
    const q = search.trim();
    if (!q) return BANK_OPTIONS;
    const norm = normalizeBankCode(q);
    const lower = q.toLowerCase();
    return BANK_OPTIONS.filter(
      (b) =>
        b.code.includes(norm) ||
        b.nameAr.includes(q) ||
        b.nameAr.toLowerCase().includes(lower),
    );
  }, [search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between gap-2 px-3 text-sm font-normal",
            "hover:bg-muted/40",
            className,
          )}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            {current ? (
              // Selected state: code pill + bank name
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="inline-flex items-center justify-center rounded-md bg-primary/10 text-primary font-mono font-bold text-[11px] px-2 py-0.5 shrink-0 ltr-nums">
                  {current.code}
                </span>
                <span className="truncate text-sm font-medium text-foreground">
                  {current.nameAr}
                </span>
              </div>
            ) : value ? (
              // Free-text code the user typed manually — no registry match
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="inline-flex items-center justify-center rounded-md bg-muted text-muted-foreground font-mono font-bold text-[11px] px-2 py-0.5 shrink-0 ltr-nums">
                  {value}
                </span>
                <span className="truncate text-xs text-muted-foreground italic">
                  رقم يدوي
                </span>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </div>
          {/* Clear button — only when a value is selected. Stops the click
              from propagating to the popover trigger. */}
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              aria-label="مسح"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange(null);
                }
              }}
              className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(popoverWidthClassName, "p-0")}
        align="start"
        dir="rtl"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="ابحث بالاسم أو الرقم..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList
            className="max-h-[340px] overflow-y-auto overscroll-contain"
            // The popover can render inside a dialog whose own body is
            // also scrollable (PaymentEditDialog). Without stopping the
            // wheel here, the wheel event bubbles out of the portal and
            // scrolls the dialog instead of the list.
            onWheel={(e) => e.stopPropagation()}
          >
            <CommandEmpty className="py-6 text-center text-xs">
              لا توجد نتائج — اكتب رقم البنك للإضافة يدوياً
            </CommandEmpty>

            {manualOption && (
              <CommandGroup heading="إضافة يدوية">
                <CommandItem
                  value={`manual-${manualOption.code}`}
                  onSelect={() => {
                    onChange(manualOption.code);
                    setOpen(false);
                    setSearch("");
                  }}
                  // Kill cmdk's data-[selected=true] bg so the row never
                  // flashes navy on keyboard focus. We use hover-based
                  // styling instead, which only triggers on real mouse
                  // hover.
                  className="gap-3 py-2.5 !bg-transparent data-[selected=true]:!bg-muted/60 data-[selected=true]:!text-foreground hover:!bg-muted/60"
                >
                  {/* Source order: pill first → in RTL flex it lands on
                      the start edge = physical-right. `dir="ltr"` on
                      the pill forces the digits to center properly
                      inside the fixed-width box (without it the RTL
                      context pushes them to the right edge). */}
                  <span
                    dir="ltr"
                    className="bank-code-pill inline-flex items-center justify-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono font-bold text-[11px] w-10 h-6 shrink-0 border border-amber-500/30"
                  >
                    {manualOption.code}
                  </span>
                  <span className="bank-name text-xs text-muted-foreground flex-1 text-right">
                    استخدام الرقم <span dir="ltr" className="font-mono">{manualOption.code}</span> بدون اسم
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandGroup heading="قائمة البنوك">
              {filteredBanks.map((b) => {
                const isSelected = normalizeBankCode(value) === b.code;
                return (
                  <CommandItem
                    key={b.code}
                    value={b.code}
                    onSelect={() => {
                      onChange(b.code);
                      setOpen(false);
                      setSearch("");
                    }}
                    // Kill cmdk's navy keyboard-highlight bg. Rows get a
                    // subtle muted bg on real mouse hover only, and the
                    // currently selected bank stays muted too so you
                    // can see which one is active.
                    className="gap-3 py-2.5 !bg-transparent data-[selected=true]:!bg-muted/60 data-[selected=true]:!text-foreground hover:!bg-muted/60"
                  >
                    {/* Source order: pill → name → check. In RTL flex
                        this renders physically as: check | name | pill,
                        putting the code on the physical-right edge. */}
                    <span
                      dir="ltr"
                      className={cn(
                        "bank-code-pill inline-flex items-center justify-center rounded-md font-mono font-bold text-[11px] w-10 h-6 shrink-0 border",
                        isSelected
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground border-border",
                      )}
                    >
                      {b.code}
                    </span>
                    <span
                      className={cn(
                        "bank-name text-sm flex-1 truncate text-right",
                        isSelected ? "font-semibold text-foreground" : "text-foreground",
                      )}
                    >
                      {b.nameAr}
                    </span>
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0 text-primary",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

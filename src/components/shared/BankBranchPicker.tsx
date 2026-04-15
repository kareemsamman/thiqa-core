import { useState, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { Check, ChevronsUpDown } from "lucide-react";
import { BANK_OPTIONS, getBank, normalizeBankCode } from "@/lib/banks";
import { cn } from "@/lib/utils";

interface BankBranchPickerProps {
  bankCode: string | null | undefined;
  branchCode: string | null | undefined;
  onBankChange: (code: string | null) => void;
  onBranchChange: (code: string | null) => void;
  /** Hide the three labels above the fields. */
  hideLabels?: boolean;
  /** Disable all three inputs (locked/readonly payment rows). */
  disabled?: boolean;
  /** Extra tailwind classes for the outer wrapper. */
  className?: string;
  /** Optional cheque-number slot rendered inline to the left of bank/branch
   *  so the three cheque fields share one row in forms. Pass a JSX element
   *  with the cheque-number Input + Label inside. */
  chequeNumberSlot?: React.ReactNode;
}

// Single-row picker used by every cheque-entry form in the app. Layout:
//   بنك (searchable combobox + manual entry) → فرع (numeric) → رقم الشيك (optional slot)
// The combobox accepts free-text entry so staff can type a code that
// isn't in the registry yet — the stored value stays exactly what the
// user typed, and `getBankName()` falls back to the code on display.
export function BankBranchPicker({
  bankCode,
  branchCode,
  onBankChange,
  onBranchChange,
  hideLabels,
  disabled,
  className,
  chequeNumberSlot,
}: BankBranchPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const current = useMemo(() => getBank(bankCode), [bankCode]);

  // Local manual-entry accepted when the typed value is a digit string that
  // doesn't match any registry entry. We don't reject — we just add a
  // synthetic item at the top of the list so the user can select it.
  const manualOption = useMemo(() => {
    const typed = normalizeBankCode(search);
    if (!typed) return null;
    if (BANK_OPTIONS.some((b) => b.code === typed)) return null;
    if (!/^\d{2,}$/.test(typed)) return null;
    return { code: typed, nameAr: `استخدام الرقم ${typed}` };
  }, [search]);

  return (
    <div
      className={cn(
        "grid gap-3",
        // 3 columns when the cheque slot is provided (bank → branch →
        // cheque#), 2 otherwise. Collapses to 1 col on narrow screens.
        chequeNumberSlot
          ? "grid-cols-1 sm:grid-cols-[1.4fr_0.7fr_1fr]"
          : "grid-cols-1 sm:grid-cols-[1.6fr_0.8fr]",
        className,
      )}
    >
      {/* Bank — searchable combobox */}
      <div className="space-y-1.5 min-w-0">
        {!hideLabels && (
          <Label className="text-xs font-semibold">البنك</Label>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className="h-9 w-full justify-between px-3 text-sm font-normal"
            >
              <span className="truncate">
                {current ? (
                  <>
                    <span className="ltr-nums text-muted-foreground mr-1">
                      ({current.code})
                    </span>
                    {current.nameAr}
                  </>
                ) : bankCode ? (
                  <span className="ltr-nums">{bankCode}</span>
                ) : (
                  <span className="text-muted-foreground">اختر البنك</span>
                )}
              </span>
              <ChevronsUpDown className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[min(360px,90vw)] p-0"
            align="start"
            dir="rtl"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="ابحث بالاسم أو الرقم..."
                value={search}
                onValueChange={setSearch}
              />
              <CommandList>
                <CommandEmpty>لا توجد نتائج — اكتب رقم البنك للإضافة يدوياً.</CommandEmpty>
                {manualOption && (
                  <CommandGroup heading="إضافة يدوية">
                    <CommandItem
                      value={`manual-${manualOption.code}`}
                      onSelect={() => {
                        onBankChange(manualOption.code);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check className="ml-2 h-4 w-4 opacity-0" />
                      <span className="ltr-nums font-mono text-foreground mr-1">
                        {manualOption.code}
                      </span>
                      <span className="text-muted-foreground">— {manualOption.nameAr}</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                <CommandGroup heading="قائمة البنوك">
                  {BANK_OPTIONS.filter((b) => {
                    const q = search.trim();
                    if (!q) return true;
                    const norm = normalizeBankCode(q);
                    return (
                      b.code.includes(norm) ||
                      b.nameAr.includes(q) ||
                      b.nameAr.toLowerCase().includes(q.toLowerCase())
                    );
                  }).map((b) => (
                    <CommandItem
                      key={b.code}
                      value={b.code}
                      onSelect={() => {
                        onBankChange(b.code);
                        setOpen(false);
                        setSearch("");
                      }}
                    >
                      <Check
                        className={cn(
                          "ml-2 h-4 w-4",
                          bankCode === b.code ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="ltr-nums font-mono w-8 shrink-0 text-muted-foreground">
                        {b.code}
                      </span>
                      <span className="truncate text-sm">{b.nameAr}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Branch — numeric free-text */}
      <div className="space-y-1.5 min-w-0">
        {!hideLabels && (
          <Label className="text-xs font-semibold">الفرع</Label>
        )}
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          className="h-9 text-sm ltr-nums font-mono"
          placeholder="مثال: 305"
          value={branchCode || ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            onBranchChange(v || null);
          }}
          disabled={disabled}
        />
      </div>

      {/* Optional cheque-number slot — when provided, renders on the same
          row as bank/branch so the three cheque identifiers line up. */}
      {chequeNumberSlot && (
        <div className="space-y-1.5 min-w-0">{chequeNumberSlot}</div>
      )}
    </div>
  );
}

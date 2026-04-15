import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BANK_OPTIONS } from "@/lib/banks";
import { cn } from "@/lib/utils";

interface BankBranchPickerProps {
  bankCode: string | null | undefined;
  branchCode: string | null | undefined;
  onBankChange: (code: string | null) => void;
  onBranchChange: (code: string | null) => void;
  /** Hide the two labels above the fields — use when the caller already
   *  renders its own label row (e.g. compact inline forms). */
  hideLabels?: boolean;
  /** Disable both inputs — used on locked/readonly payment rows. */
  disabled?: boolean;
  /** Extra tailwind classes for the outer grid. */
  className?: string;
}

// Compact 2-column picker used by every cheque-entry form in the app so
// bank / branch stay in one visual block. Bank codes come from the IL + PS
// registry in src/lib/banks.ts; branch is a short numeric free-text input
// because branches aren't centrally registered per bank.
export function BankBranchPicker({
  bankCode,
  branchCode,
  onBankChange,
  onBranchChange,
  hideLabels,
  disabled,
  className,
}: BankBranchPickerProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <div className="space-y-1.5">
        {!hideLabels && (
          <Label className="text-xs font-semibold">البنك</Label>
        )}
        <Select
          value={bankCode || ""}
          onValueChange={(val) => onBankChange(val || null)}
          disabled={disabled}
          dir="rtl"
        >
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="اختر البنك" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>البنوك الإسرائيلية</SelectLabel>
              {BANK_OPTIONS.filter((b) => b.country === "IL").map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  <span className="text-sm">{b.nameAr}</span>
                  <span className="ltr-nums text-[10px] text-muted-foreground mr-2">
                    ({b.code})
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>البنوك الفلسطينية</SelectLabel>
              {BANK_OPTIONS.filter((b) => b.country === "PS").map((b) => (
                <SelectItem key={b.code} value={b.code}>
                  <span className="text-sm">{b.nameAr}</span>
                  <span className="ltr-nums text-[10px] text-muted-foreground mr-2">
                    ({b.code})
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        {!hideLabels && (
          <Label className="text-xs font-semibold">الفرع</Label>
        )}
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          className="h-9 text-sm ltr-nums"
          placeholder="مثال: 305"
          value={branchCode || ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            onBranchChange(v || null);
          }}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

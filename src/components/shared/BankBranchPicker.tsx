import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BankPicker } from "./BankPicker";
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

// Single-row picker used by every cheque-entry form. Layout:
//   بنك (BankPicker combobox) → فرع (numeric) → رقم الشيك (optional slot)
//
// This file is a thin composition on top of BankPicker — if you need just
// a bank dropdown (without the branch input), import BankPicker directly.
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
  return (
    <div
      className={cn(
        "grid gap-2",
        // Always horizontal — bank/branch/cheque# stay on a single row
        // at every viewport. The bank column takes the lion's share,
        // branch is a narrow 3-digit numeric, cheque# gets a fair slice.
        chequeNumberSlot
          ? "grid-cols-[minmax(0,1.6fr)_minmax(90px,0.7fr)_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1.8fr)_minmax(90px,0.7fr)]",
        className,
      )}
    >
      <div className="space-y-1.5 min-w-0">
        {!hideLabels && (
          <Label className="text-xs font-semibold">البنك</Label>
        )}
        <BankPicker
          value={bankCode}
          onChange={onBankChange}
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5 min-w-0">
        {!hideLabels && (
          <Label className="text-xs font-semibold">الفرع</Label>
        )}
        <Input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          className="h-10 text-sm ltr-nums font-mono"
          placeholder="مثال: 305"
          value={branchCode || ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            onBranchChange(v || null);
          }}
          disabled={disabled}
        />
      </div>

      {chequeNumberSlot && (
        <div className="space-y-1.5 min-w-0">{chequeNumberSlot}</div>
      )}
    </div>
  );
}

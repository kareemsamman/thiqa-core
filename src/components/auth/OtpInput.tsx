import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function OtpInput({ value, onChange, disabled }: OtpInputProps) {
  // Handle paste - extract only digits
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData("text");
    const digits = pastedData.replace(/\D/g, "").slice(0, 4);
    if (digits) {
      onChange(digits);
    }
  };

  return (
    <div
      className="flex justify-center ltr-nums"
      onPaste={handlePaste}
    >
      <InputOTP
        maxLength={4}
        value={value}
        onChange={(val) => {
          // Only allow digits
          const digitsOnly = val.replace(/\D/g, "");
          onChange(digitsOnly);
        }}
        disabled={disabled}
        pattern="[0-9]*"
        inputMode="numeric"
        autoComplete="one-time-code"
      >
        <InputOTPGroup className="gap-2 sm:gap-3">
          <InputOTPSlot
            index={0}
            className="w-12 h-14 sm:w-14 sm:h-16 text-2xl sm:text-3xl font-bold border-2 border-border rounded-xl bg-background shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all"
          />
          <InputOTPSlot
            index={1}
            className="w-12 h-14 sm:w-14 sm:h-16 text-2xl sm:text-3xl font-bold border-2 border-border rounded-xl bg-background shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all"
          />
          <InputOTPSlot
            index={2}
            className="w-12 h-14 sm:w-14 sm:h-16 text-2xl sm:text-3xl font-bold border-2 border-border rounded-xl bg-background shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all"
          />
          <InputOTPSlot
            index={3}
            className="w-12 h-14 sm:w-14 sm:h-16 text-2xl sm:text-3xl font-bold border-2 border-border rounded-xl bg-background shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 transition-all"
          />
        </InputOTPGroup>
      </InputOTP>
    </div>
  );
}

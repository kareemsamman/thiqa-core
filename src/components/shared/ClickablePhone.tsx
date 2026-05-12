import { Phone, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { useClick2Call } from "@/hooks/useClick2Call";
import { Click2CallDialog } from "./Click2CallDialog";

interface ClickablePhoneProps {
  phone: string | null | undefined;
  className?: string;
  iconClassName?: string;
  showIcon?: boolean;
}

function isMobile() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

export function ClickablePhone({
  phone,
  className,
  iconClassName,
  showIcon = true,
}: ClickablePhoneProps) {
  const [copied, setCopied] = useState(false);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  // When the worker has Click2Call ready (enabled + at least one
  // extension), clicking the number opens the call dialog directly.
  // Otherwise we fall back to the legacy tel:/copy behavior so
  // non-Click2Call users see no UI change.
  const { ready: c2cReady } = useClick2Call();

  if (!phone) {
    return <span className="text-muted-foreground">-</span>;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (c2cReady) {
      setCallDialogOpen(true);
      return;
    }

    if (isMobile()) {
      window.location.href = `tel:${phone}`;
    } else {
      navigator.clipboard.writeText(phone).then(() => {
        setCopied(true);
        toast.success("تم نسخ الرقم");
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        toast.error("فشل في نسخ الرقم");
      });
    }
  };

  const title = c2cReady
    ? `اتصال ${phone}`
    : isMobile()
      ? `اتصال ${phone}`
      : "نسخ الرقم";

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer group",
          className
        )}
        title={title}
      >
        {showIcon && (
          copied
            ? <Check className={cn("h-3 w-3 text-green-600 shrink-0", iconClassName)} />
            : <Phone className={cn("h-3 w-3 shrink-0 group-hover:text-primary transition-colors", iconClassName)} />
        )}
        <bdi className="font-mono ltr-nums font-semibold tracking-wide text-foreground/85 group-hover:underline group-hover:text-primary transition-colors">
          {phone}
        </bdi>
      </button>
      {c2cReady && callDialogOpen && (
        <Click2CallDialog
          open={callDialogOpen}
          onOpenChange={setCallDialogOpen}
          phoneNumber={phone}
        />
      )}
    </span>
  );
}

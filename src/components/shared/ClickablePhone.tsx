import { Phone, Copy, Check, PhoneCall } from "lucide-react";
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
  // Call button only renders when the current worker has both an
  // enabled config and at least one extension to place a call from.
  // Anything less and we silently fall back to the existing tel:/copy
  // behavior so non-Click2Call users see no UI change.
  const { ready: c2cReady } = useClick2Call();

  if (!phone) {
    return <span className="text-muted-foreground">-</span>;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isMobile()) {
      // Mobile: open phone dialer
      window.location.href = `tel:${phone}`;
    } else {
      // Desktop: copy to clipboard
      navigator.clipboard.writeText(phone).then(() => {
        setCopied(true);
        toast.success("تم نسخ الرقم");
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        toast.error("فشل في نسخ الرقم");
      });
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer group",
          className
        )}
        title={isMobile() ? `اتصال ${phone}` : "نسخ الرقم"}
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
      {c2cReady && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setCallDialogOpen(true);
          }}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-primary hover:bg-primary/10 transition-colors shrink-0"
          title="اتصال سريع"
          aria-label="اتصال سريع"
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </button>
      )}
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

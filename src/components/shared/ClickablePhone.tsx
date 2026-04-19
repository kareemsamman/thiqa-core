import { Phone, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

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
  );
}

import { useEffect, useState, ReactNode } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThiqaAgentSearch } from "./ThiqaAgentSearch";

interface ThiqaHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional extra content rendered in the cluster (e.g. page-level actions). */
  actions?: ReactNode;
}

const ICON_BUTTON_CLASS =
  "h-11 w-11 rounded-full bg-secondary/70 hover:bg-secondary transition-colors text-foreground";

export function ThiqaHeader({ title, subtitle, actions }: ThiqaHeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  // Cmd/Ctrl+K opens the agent search from anywhere inside a Thiqa
  // admin page. Mirrors the convention command palettes use across
  // most apps so the keyboard path is discoverable.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* Desktop header — title on the right, search + actions on the left. */}
      <div
        className="hidden md:flex items-center justify-between gap-4 mb-6"
        dir="rtl"
      >
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            onClick={() => setSearchOpen(true)}
            className={cn(
              "h-11 px-4 rounded-full bg-secondary/70 hover:bg-secondary text-foreground gap-2",
            )}
            aria-label="بحث عن وكيل"
            title="بحث عن وكيل (Ctrl+K)"
          >
            <Search className="h-[18px] w-[18px]" />
            <span className="text-sm text-muted-foreground">ابحث عن وكيل...</span>
            <kbd className="ml-1 hidden lg:inline-flex h-6 items-center gap-1 rounded border border-border/60 bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
              Ctrl K
            </kbd>
          </Button>
          {actions}
        </div>
      </div>

      {/* Mobile header — stacked title + icon-only search button. */}
      <div className="md:hidden mb-4" dir="rtl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-foreground truncate leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-[13px] text-muted-foreground truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            className={cn(ICON_BUTTON_CLASS, "h-10 w-10 shrink-0")}
            aria-label="بحث عن وكيل"
          >
            <Search className="h-[18px] w-[18px]" />
          </Button>
        </div>
        {actions && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">{actions}</div>
        )}
      </div>

      <ThiqaAgentSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

import { useState, ReactNode } from "react";
import { Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobalPolicySearch } from "./GlobalPolicySearch";

interface HeaderProps {
  title: string;
  subtitle?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ReactNode;
  };
}

export function Header({ title, subtitle, action }: HeaderProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      {/* Desktop header */}
      <header className="hidden md:flex sticky top-0 z-30 h-16 items-center justify-between glass border-b border-[hsl(var(--glass-border))] px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            className="hidden lg:flex gap-2"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">بحث عن وثيقة...</span>
            <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              ⌘K
            </kbd>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden h-9 w-9"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </Button>

          {action && (
            <Button onClick={action.onClick} size="sm" className="text-sm">
              {action.icon || <Plus className="h-4 w-4 ml-2" />}
              {action.label && <span>{action.label}</span>}
            </Button>
          )}
        </div>
      </header>

      {/* Mobile header - just title, no glass/sticky since navbar handles that */}
      <div className="md:hidden flex items-center justify-between px-1 pb-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </Button>
          {action && (
            <Button onClick={action.onClick} size="sm" className="text-xs h-8">
              {action.icon || <Plus className="h-3 w-3 ml-1" />}
              {action.label && <span>{action.label}</span>}
            </Button>
          )}
        </div>
      </div>

      {/* Global Policy Search Dialog */}
      <GlobalPolicySearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
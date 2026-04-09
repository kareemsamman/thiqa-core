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
      <header className="sticky top-0 z-30 flex h-14 md:h-16 items-center justify-between glass border-b border-[hsl(var(--glass-border))] px-3 md:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-xl font-semibold text-foreground truncate">{title}</h1>
          {subtitle && (
            <p className="text-xs md:text-sm text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {/* Global Policy Search Button */}
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
          
          {/* Mobile search button */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="lg:hidden h-9 w-9"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-4 w-4 text-muted-foreground" />
          </Button>

          {/* Action button - only for specific pages like Clients */}
          {action && (
            <Button onClick={action.onClick} size="sm" className="text-xs md:text-sm">
              {action.icon || <Plus className="h-3 w-3 md:h-4 md:w-4 ml-1 md:ml-2" />}
              {action.label && <span className="hidden sm:inline">{action.label}</span>}
              {!action.icon && !action.label && <span className="sm:hidden">جديد</span>}
            </Button>
          )}
        </div>
      </header>

      {/* Global Policy Search Dialog */}
      <GlobalPolicySearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { navigationGroups } from "./Sidebar";



interface SidebarSearchProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

export function SidebarSearch({ collapsed, onNavigate }: SidebarSearchProps) {
  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin } = useAuth();

  // Filter groups and items based on role
  const filteredItems = navigationGroups
    .filter(group => {
      if (isSuperAdmin) return group.items.some(item => item.thiqaSuperAdminOnly);
      return !group.adminOnly || isAdmin;
    })
    .flatMap(group => 
      group.items.filter(item => {
        if (isSuperAdmin) return !!item.thiqaSuperAdminOnly;
        if (item.thiqaSuperAdminOnly) return false;
        if (item.superAdminOnly && !isSuperAdmin) return false;
        if (item.adminOnly && !isAdmin) return false;
        return true;
      })
    );

  // Filter by search query
  const results = query.trim()
    ? filteredItems.filter(item => 
        item.name.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  // Handle keyboard shortcut Ctrl+/
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (href: string) => {
    setQuery("");
    setShowResults(false);
    navigate(href);
    onNavigate?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setShowResults(false);
      setQuery("");
    }
    if (e.key === "Enter" && results.length > 0) {
      handleSelect(results[0].href);
    }
  };

  if (collapsed) return null;

  return (
    <div ref={containerRef} className="px-3 py-2 border-b border-white/[0.08]">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          placeholder="ابحث عن صفحة..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          onKeyDown={handleKeyDown}
          className="pr-9 text-right text-sm h-9 bg-white/90 backdrop-blur-md text-foreground placeholder:text-muted-foreground border border-white/20 shadow-sm rounded-lg focus-visible:ring-1 focus-visible:ring-white/30"
          dir="rtl"
        />
        
        {/* Results dropdown */}
        {showResults && query.trim() && (
          <div className="absolute top-full right-0 mt-1 w-full glass-dark rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {results.length > 0 ? (
              results.map((item) => (
                <button
                  key={item.href}
                  onClick={() => handleSelect(item.href)}
                  className={cn(
                    "flex items-center gap-3 w-full px-3 py-2 text-sm text-right text-sidebar-foreground",
                    "hover:bg-[hsl(var(--sidebar-active))]/10 transition-colors",
                    "first:rounded-t-lg last:rounded-b-lg"
                  )}
                  dir="rtl"
                >
                  <item.icon className="h-4 w-4 text-sidebar-foreground/50 flex-shrink-0" />
                  <span>{item.name}</span>
                </button>
              ))
            ) : (
              <div className="px-3 py-2 text-sm text-sidebar-foreground/40 text-center">
                لا توجد نتائج
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

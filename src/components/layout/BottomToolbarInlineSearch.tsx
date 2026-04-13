import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X, User, Car, Phone } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { normalizeArabic } from "@/lib/arabicNormalize";

interface ClientResult {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
  cars: string[];
  matchedCarId?: string;
}

interface BottomToolbarInlineSearchProps {
  className?: string;
}

export function BottomToolbarInlineSearch({ className }: BottomToolbarInlineSearchProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClientResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestRequestRef = useRef(0);

  const canShow = location.pathname !== "/login" && location.pathname !== "/no-access";

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setShowDropdown(false);
  }, []);

  const runSearch = useCallback(async (term: string) => {
    const requestId = Date.now();
    latestRequestRef.current = requestId;

    setLoading(true);
    try {
      const searchTerm = term.trim();

      const [clientsRes, carsRes] = await Promise.all([
        supabase
          .from("clients")
          .select("id, full_name, id_number, phone_number")
          .is("deleted_at", null)
          .or(
            `full_name_normalized.ilike.%${normalizeArabic(searchTerm)}%,phone_number.ilike.%${searchTerm}%,id_number.ilike.%${searchTerm}%,file_number.ilike.%${searchTerm}%`,
          )
          .limit(10),
        supabase
          .from("cars")
          .select("id, client_id, car_number, clients(id, full_name, id_number, phone_number)")
          .is("deleted_at", null)
          .ilike("car_number", `%${searchTerm}%`)
          .limit(10),
      ]);

      if (latestRequestRef.current !== requestId) return;

      if (clientsRes.error) throw clientsRes.error;
      if (carsRes.error) throw carsRes.error;

      const map = new Map<string, ClientResult>();

      for (const c of clientsRes.data || []) {
        map.set(c.id, {
          id: c.id,
          full_name: c.full_name,
          id_number: c.id_number,
          phone_number: c.phone_number,
          cars: [],
        });
      }

      for (const row of carsRes.data || []) {
        const client = (row as any).clients as {
          id: string;
          full_name: string;
          id_number: string;
          phone_number: string | null;
        } | null;
        if (!client) continue;

        const carNumber = (row as any).car_number as string;
        const carId = (row as any).id as string;
        const isCarMatch = carNumber.toLowerCase().includes(searchTerm.toLowerCase());

        if (!map.has(client.id)) {
          map.set(client.id, {
            id: client.id,
            full_name: client.full_name,
            id_number: client.id_number,
            phone_number: client.phone_number,
            cars: [],
            matchedCarId: isCarMatch ? carId : undefined,
          });
        } else if (isCarMatch && !map.get(client.id)?.matchedCarId) {
          // If this car matches the search and we don't have a matched car yet
          map.get(client.id)!.matchedCarId = carId;
        }
      }

      const clientIds = Array.from(map.keys());

      if (clientIds.length) {
        const { data: allCars, error: allCarsError } = await supabase
          .from("cars")
          .select("client_id, car_number")
          .is("deleted_at", null)
          .in("client_id", clientIds)
          .order("created_at", { ascending: false })
          .limit(60);

        if (allCarsError) throw allCarsError;

        for (const car of allCars || []) {
          const entry = map.get(car.client_id);
          if (!entry) continue;
          if (entry.cars.length >= 3) continue;
          if (!entry.cars.includes(car.car_number)) entry.cars.push(car.car_number);
        }
      }

      setResults(Array.from(map.values()).slice(0, 10));
      setShowDropdown(true);
    } catch (e) {
      console.error("Inline search error:", e);
      setResults([]);
    } finally {
      if (latestRequestRef.current === requestId) setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setShowDropdown(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const t = setTimeout(() => runSearch(term), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [closeDropdown]);

  const handleSelect = (clientId: string, matchedCarId?: string) => {
    clearSearch();
    // Navigate with car filter if a car was matched
    const url = matchedCarId 
      ? `/clients/${clientId}?car=${matchedCarId}`
      : `/clients/${clientId}`;
    navigate(url);
  };

  const handleFocus = () => {
    if (query.trim().length >= 2 && results.length > 0) {
      setShowDropdown(true);
    }
  };

  if (!canShow) return null;

  return (
    <div ref={containerRef} className={cn("relative flex items-center", className)}>
      {/* Always visible search input */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          placeholder="بحث..."
          className={cn(
            "h-9 w-[140px] sm:w-[200px] rounded-full pr-9 pl-8",
            "bg-background/70 border-border/50"
          )}
        />
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full"
            onClick={clearSearch}
            aria-label="مسح"
            tabIndex={-1}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Dropdown results - positioned above */}
      {showDropdown && (
        <div
          className={cn(
            "absolute bottom-full mb-3 left-1/2 -translate-x-1/2",
            "w-[min(92vw,400px)] max-h-[360px] overflow-y-auto",
            "rounded-lg border border-border bg-popover p-2 shadow-lg"
          )}
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-md border border-border/60 p-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-3 w-56" />
                </div>
              ))}
            </div>
          ) : results.length > 0 ? (
            <div className="space-y-1">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={cn(
                    "w-full text-right rounded-md border border-border/60 p-2 transition-colors",
                    "hover:bg-accent/40 focus:bg-accent/40 focus:outline-none"
                  )}
                  onMouseDown={(e) => {
                    // Use mouseDown to prevent input blur before navigation
                    e.preventDefault();
                    handleSelect(r.id, r.matchedCarId);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium truncate">{r.full_name}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {r.phone_number && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            <bdi className="ltr-nums">{r.phone_number}</bdi>
                          </span>
                        )}
                        {r.cars.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Car className="h-3.5 w-3.5" />
                            <bdi className="ltr-nums">{r.cars.join(", ")}</bdi>
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground ltr-nums">{r.id_number}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">لا توجد نتائج</div>
          )}
        </div>
      )}
    </div>
  );
}

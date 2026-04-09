import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Search, User, Car, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClientSearchResult {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
  cars: {
    car_number: string;
  }[];
  policies_count: number;
  matchedCarId?: string;
}

interface GlobalPolicySearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPolicy?: (policyId: string) => void;
}

export function GlobalPolicySearch({ open, onOpenChange }: GlobalPolicySearchProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery("");
      setResults([]);
      setSearched(false);
    }
  }, [open]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const searchTerm = query.trim();
      
      // Search clients by name, phone, id_number
      const { data: clientsData, error: clientsError } = await supabase
        .from("clients")
        .select(`
          id,
          full_name,
          id_number,
          phone_number
        `)
        .is("deleted_at", null)
        .or(`full_name.ilike.%${searchTerm}%,phone_number.ilike.%${searchTerm}%,id_number.ilike.%${searchTerm}%`)
        .limit(10);

      if (clientsError) throw clientsError;

      // Also search by car number
      const { data: carsData, error: carsError } = await supabase
        .from("cars")
        .select(`
          id,
          client_id,
          car_number,
          clients(id, full_name, id_number, phone_number)
        `)
        .is("deleted_at", null)
        .ilike("car_number", `%${searchTerm}%`)
        .limit(10);

      if (carsError) throw carsError;

      // Merge results - unique clients
      const clientMap = new Map<string, ClientSearchResult>();

      // Add clients from direct search
      for (const client of clientsData || []) {
        if (!clientMap.has(client.id)) {
          // Fetch cars for this client
          const { data: clientCars } = await supabase
            .from("cars")
            .select("car_number")
            .eq("client_id", client.id)
            .is("deleted_at", null)
            .limit(3);

          // Count policies
          const { count } = await supabase
            .from("policies")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .is("deleted_at", null);

          clientMap.set(client.id, {
            id: client.id,
            full_name: client.full_name,
            id_number: client.id_number,
            phone_number: client.phone_number,
            cars: clientCars || [],
            policies_count: count || 0,
          });
        }
      }

      // Add clients from car search
      for (const car of carsData || []) {
        const client = car.clients as any;
        const carId = (car as any).id as string;
        const carNumber = car.car_number;
        const isCarMatch = carNumber.toLowerCase().includes(searchTerm.toLowerCase());
        
        if (client && !clientMap.has(client.id)) {
          // Fetch all cars for this client
          const { data: clientCars } = await supabase
            .from("cars")
            .select("car_number")
            .eq("client_id", client.id)
            .is("deleted_at", null)
            .limit(3);

          // Count policies
          const { count } = await supabase
            .from("policies")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .is("deleted_at", null);

          clientMap.set(client.id, {
            id: client.id,
            full_name: client.full_name,
            id_number: client.id_number,
            phone_number: client.phone_number,
            cars: clientCars || [],
            policies_count: count || 0,
            matchedCarId: isCarMatch ? carId : undefined,
          });
        } else if (client && isCarMatch && !clientMap.get(client.id)?.matchedCarId) {
          // If this car matches and we don't have a matched car yet
          clientMap.get(client.id)!.matchedCarId = carId;
        }
      }

      setResults(Array.from(clientMap.values()));
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  }, [query]);

  // Debounced search
  useEffect(() => {
    if (query.length >= 2) {
      const timer = setTimeout(handleSearch, 300);
      return () => clearTimeout(timer);
    } else {
      setResults([]);
      setSearched(false);
    }
  }, [query, handleSearch]);

  const handleSelectClient = (clientId: string, matchedCarId?: string) => {
    onOpenChange(false);
    const url = matchedCarId 
      ? `/clients/${clientId}?car=${matchedCarId}`
      : `/clients/${clientId}`;
    navigate(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            بحث سريع عن عميل
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="اسم العميل، رقم الهاتف، أو رقم السيارة..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              className="pr-10"
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setQuery("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-3 border rounded-lg">
                  <Skeleton className="h-4 w-3/4 mb-2" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : results.length > 0 ? (
              results.map((result) => (
                <button
                  key={result.id}
                  className={cn(
                    "w-full text-right p-3 border rounded-lg transition-colors",
                    "hover:bg-secondary/50 focus:bg-secondary/50 focus:outline-none"
                  )}
                  onClick={() => handleSelectClient(result.id, result.matchedCarId)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium truncate">
                          {result.full_name}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        {result.phone_number && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <bdi className="font-mono">{result.phone_number}</bdi>
                          </span>
                        )}
                        {result.cars.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Car className="h-3 w-3" />
                            <bdi className="font-mono">
                              {result.cars.map(c => c.car_number).join(", ")}
                            </bdi>
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {result.policies_count} وثيقة
                    </Badge>
                  </div>
                </button>
              ))
            ) : searched ? (
              <div className="text-center py-8 text-muted-foreground">
                <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>لا توجد نتائج</p>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>ابدأ بالكتابة للبحث...</p>
              </div>
            )}
          </div>

          {/* Hint */}
          <p className="text-xs text-muted-foreground text-center">
            يمكنك البحث باسم العميل، رقم الهاتف، أو رقم السيارة
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
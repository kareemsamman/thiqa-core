import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X, User, Car, Phone, FileText, Receipt } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { normalizeArabic } from "@/lib/arabicNormalize";
import { PolicyDetailsDrawer } from "@/components/policies/PolicyDetailsDrawer";

interface ClientResult {
  id: string;
  full_name: string;
  id_number: string;
  phone_number: string | null;
  cars: string[];
  matchedCarId?: string;
}

interface PolicyResult {
  kind: "policy" | "receipt";
  policyId: string;
  label: string;            // e.g. "35/2026" (document_number) or "R-2026-00017"
  subLabel: string | null;  // client + car hint
  clientName: string | null;
  carNumber: string | null;
}

interface BottomToolbarInlineSearchProps {
  className?: string;
}

export function BottomToolbarInlineSearch({ className }: BottomToolbarInlineSearchProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClientResult[]>([]);
  const [policyResults, setPolicyResults] = useState<PolicyResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Inline policy preview — opened when the user clicks a policy or
  // receipt result, so search-by-document-number lands on the drawer
  // without leaving the current page.
  const [previewPolicyId, setPreviewPolicyId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const latestRequestRef = useRef(0);

  const canShow = location.pathname !== "/login" && location.pathname !== "/no-access";

  const closeDropdown = useCallback(() => {
    setShowDropdown(false);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setResults([]);
    setPolicyResults([]);
    setShowDropdown(false);
  }, []);

  const runSearch = useCallback(async (term: string) => {
    const requestId = Date.now();
    latestRequestRef.current = requestId;

    setLoading(true);
    try {
      const searchTerm = term.trim();

      const [clientsRes, carsRes, policiesRes, receiptsRes] = await Promise.all([
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
        // Policies matched by document_number or policy_number. The
        // document_number is the human-readable "35/2026" form shown
        // on invoices; policy_number is the external insurer ref.
        supabase
          .from("policies")
          .select(
            "id, document_number, policy_number, client_id, clients(full_name), car:cars(car_number)",
          )
          .is("deleted_at", null)
          .or(`document_number.ilike.%${searchTerm}%,policy_number.ilike.%${searchTerm}%`)
          .limit(8),
        // Payment receipts matched by receipt_number — typing a
        // receipt number takes the user straight to that policy's
        // drawer.
        supabase
          .from("policy_payments")
          .select(
            "id, receipt_number, policy_id, policy:policies(id, document_number, client_id, clients(full_name), car:cars(car_number))",
          )
          .not("receipt_number", "is", null)
          .ilike("receipt_number", `%${searchTerm}%`)
          .limit(8),
      ]);

      if (latestRequestRef.current !== requestId) return;

      if (clientsRes.error) throw clientsRes.error;
      if (carsRes.error) throw carsRes.error;
      if (policiesRes.error) throw policiesRes.error;
      if (receiptsRes.error) throw receiptsRes.error;

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

      // Policy + receipt results — deduped by policy id, with the
      // document-number matches listed first and receipt-number
      // matches appended.
      const policyMap = new Map<string, PolicyResult>();
      for (const p of policiesRes.data || []) {
        const id = (p as any).id as string;
        if (!id || policyMap.has(id)) continue;
        const clientName = ((p as any).clients?.full_name as string) || null;
        const carNumber = ((p as any).car?.car_number as string) || null;
        const docNum = ((p as any).document_number as string) || null;
        const polNum = ((p as any).policy_number as string) || null;
        policyMap.set(id, {
          kind: "policy",
          policyId: id,
          label: docNum || polNum || "وثيقة",
          subLabel: [clientName, carNumber].filter(Boolean).join(" · ") || null,
          clientName,
          carNumber,
        });
      }
      for (const r of receiptsRes.data || []) {
        const policyRef = (r as any).policy;
        const policyId = (policyRef?.id as string) || ((r as any).policy_id as string) || null;
        const receiptNumber = (r as any).receipt_number as string | null;
        if (!policyId || !receiptNumber) continue;
        if (policyMap.has(`receipt:${receiptNumber}`)) continue;
        const clientName = (policyRef?.clients?.full_name as string) || null;
        const carNumber = (policyRef?.car?.car_number as string) || null;
        const docNum = (policyRef?.document_number as string) || null;
        policyMap.set(`receipt:${receiptNumber}`, {
          kind: "receipt",
          policyId,
          label: receiptNumber,
          subLabel: [docNum, clientName, carNumber].filter(Boolean).join(" · ") || null,
          clientName,
          carNumber,
        });
      }
      setPolicyResults(Array.from(policyMap.values()).slice(0, 8));

      setShowDropdown(true);
    } catch (e) {
      console.error("Inline search error:", e);
      setResults([]);
      setPolicyResults([]);
    } finally {
      if (latestRequestRef.current === requestId) setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setPolicyResults([]);
      setShowDropdown(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const t = setTimeout(() => runSearch(term), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const handleSelectPolicy = useCallback((policyId: string) => {
    setPreviewPolicyId(policyId);
    setPreviewOpen(true);
    clearSearch();
    setMobileOpen(false);
  }, [clearSearch]);

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
    setMobileOpen(false);
    // Navigate with car filter if a car was matched
    const url = matchedCarId
      ? `/clients/${clientId}?car=${matchedCarId}`
      : `/clients/${clientId}`;
    navigate(url);
  };

  // When the mobile dialog opens, autofocus the input and reset query.
  useEffect(() => {
    if (!mobileOpen) return;
    const t = setTimeout(() => mobileInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [mobileOpen]);

  const handleFocus = () => {
    if (query.trim().length >= 2 && (results.length > 0 || policyResults.length > 0)) {
      setShowDropdown(true);
    }
  };

  if (!canShow) return null;

  // Shared renderer for the result list — used by both the desktop
  // inline dropdown and the mobile dialog body.
  const renderResults = () => {
    const hasAny = results.length > 0 || policyResults.length > 0;
    return loading ? (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border/60 p-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-56" />
          </div>
        ))}
      </div>
    ) : hasAny ? (
      <div className="space-y-3">
        {/* Policy / receipt results — surfaced on top so searching
            "35/2026" or a receipt number lands on the drawer straight
            away. */}
        {policyResults.length > 0 && (
          <div className="space-y-1">
            <div className="px-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              الوثائق والسندات
            </div>
            {policyResults.map((p) => {
              const Icon = p.kind === "receipt" ? Receipt : FileText;
              return (
                <button
                  key={`${p.kind}:${p.policyId}:${p.label}`}
                  type="button"
                  className={cn(
                    "w-full text-right rounded-md border border-border/60 p-2 transition-colors",
                    "hover:bg-accent/40 focus:bg-accent/40 focus:outline-none",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectPolicy(p.policyId);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-mono ltr-nums font-semibold truncate">
                          {p.label}
                        </span>
                        {p.kind === "receipt" && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                            سند
                          </span>
                        )}
                      </div>
                      {p.subLabel && (
                        <div className="mt-1 text-xs text-muted-foreground truncate">
                          {p.subLabel}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-1">
            {policyResults.length > 0 && (
              <div className="px-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                العملاء
              </div>
            )}
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
        )}
      </div>
    ) : query.trim().length >= 2 ? (
      <div className="py-6 text-center text-sm text-muted-foreground">لا توجد نتائج</div>
    ) : (
      <div className="py-6 text-center text-sm text-muted-foreground">
        اكتب حرفين أو أكثر للبحث
      </div>
    );
  };

  // ─── Mobile: icon-only trigger + full-screen search dialog ──────────
  if (isMobile) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-9 w-9 rounded-full", className)}
          onClick={() => setMobileOpen(true)}
          aria-label="بحث"
          title="بحث"
        >
          <Search className="h-4 w-4" />
        </Button>

        <Dialog
          open={mobileOpen}
          onOpenChange={(o) => {
            setMobileOpen(o);
            if (!o) clearSearch();
          }}
        >
          <DialogContent
            className="max-w-[96vw] max-h-[92dvh] p-0 gap-0 rounded-2xl overflow-hidden flex flex-col"
            dir="rtl"
          >
            <DialogHeader className="p-4 pb-3 border-b">
              <DialogTitle className="text-base">بحث</DialogTitle>
            </DialogHeader>
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  ref={mobileInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ابحث بالاسم، رقم الهوية، رقم الهاتف..."
                  className="h-10 rounded-xl pr-9 pl-8 bg-background border-border/60"
                />
                {query && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full"
                    onClick={clearSearch}
                    aria-label="مسح"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {renderResults()}
            </div>
          </DialogContent>
        </Dialog>

        <PolicyDetailsDrawer
          policyId={previewPolicyId}
          open={previewOpen}
          onOpenChange={(o) => {
            setPreviewOpen(o);
            if (!o) setPreviewPolicyId(null);
          }}
          onViewRelatedPolicy={(id) => setPreviewPolicyId(id)}
        />
      </>
    );
  }

  // ─── Desktop: inline input + upward dropdown ────────────────────────
  return (
    <>
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
          {renderResults()}
        </div>
      )}
    </div>

    <PolicyDetailsDrawer
      policyId={previewPolicyId}
      open={previewOpen}
      onOpenChange={(o) => {
        setPreviewOpen(o);
        if (!o) setPreviewPolicyId(null);
      }}
      onViewRelatedPolicy={(id) => setPreviewPolicyId(id)}
    />
    </>
  );
}

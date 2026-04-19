import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
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
  // Which way the results dropdown opens. Bottom toolbar points up
  // because the input sits at the bottom of the viewport; the main
  // header points down so the dropdown hangs below the input.
  direction?: "up" | "down";
  // When true the dropdown takes the same width as the input wrapper
  // instead of the default fixed ~400px. Used in the header where the
  // design asks for a dropdown that visually "extends" the input.
  dropdownMatchWidth?: boolean;
  // Override the input size/shape. Callers that need the input to
  // match a larger cluster (e.g. the main header) pass a custom height
  // + width here.
  inputClassName?: string;
  // Classes applied to the input ONLY while the dropdown is open —
  // typically a larger `w-[...]` so the input grows to fit results.
  // When omitted, width is static.
  expandedInputClassName?: string;
  // When true the desktop variant starts as an icon-only button and
  // expands into the input on click. Collapses back when the user
  // clicks outside with an empty query. Mobile path unchanged.
  collapsible?: boolean;
  // Classes for the collapsed icon button (size, bg, rounded, etc.).
  collapsedIconClassName?: string;
}

export function BottomToolbarInlineSearch({
  className,
  direction = "up",
  dropdownMatchWidth = false,
  inputClassName,
  expandedInputClassName,
  collapsible = false,
  collapsedIconClassName,
}: BottomToolbarInlineSearchProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ClientResult[]>([]);
  const [policyResults, setPolicyResults] = useState<PolicyResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // When collapsible: start as the icon-only button, expand on click.
  // When not collapsible: always rendered as the input.
  const [isExpanded, setIsExpanded] = useState(!collapsible);

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
            `full_name_normalized.ilike.%${normalizeArabic(searchTerm)}%,phone_number.ilike.%${searchTerm}%,phone_number_2.ilike.%${searchTerm}%,id_number.ilike.%${searchTerm}%,file_number.ilike.%${searchTerm}%`,
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

    // Show the dropdown immediately (with the loading skeleton) so the
    // user sees "I'm searching" the moment they type enough characters,
    // instead of waiting 250ms + network for the first paint.
    setLoading(true);
    setShowDropdown(true);
    const t = setTimeout(() => runSearch(term), 250);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const handleSelectPolicy = useCallback((policyId: string) => {
    setPreviewPolicyId(policyId);
    setPreviewOpen(true);
    clearSearch();
    setMobileOpen(false);
  }, [clearSearch]);

  // Close dropdown — and collapse back to the icon — on click outside.
  // Collapse only when the query is empty so a mid-typing click doesn't
  // throw away the user's work.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        if (collapsible && !query.trim()) {
          setIsExpanded(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [collapsible, query]);

  // Autofocus the input right after we transition from icon → input.
  useEffect(() => {
    if (!collapsible || !isExpanded) return;
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => clearTimeout(t);
  }, [collapsible, isExpanded]);

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
    // Open the dropdown on focus so the user gets the "type to search"
    // hint (or previously-fetched results) as soon as they click in.
    setShowDropdown(true);
  };

  if (!canShow) return null;

  // Shared renderer for the result list — used by both the desktop
  // inline dropdown and the mobile dialog body.
  const renderResults = () => {
    const hasAny = results.length > 0 || policyResults.length > 0;
    return loading ? (
      <div className="space-y-1 p-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg p-2.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="mt-2 h-3 w-48" />
          </div>
        ))}
      </div>
    ) : hasAny ? (
      <div className="space-y-2">
        {/* Policy / receipt results — surfaced on top so searching
            "35/2026" or a receipt number lands on the drawer straight
            away. */}
        {policyResults.length > 0 && (
          <div className="space-y-0.5">
            <div className="px-2 pt-1 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              الوثائق والسندات
            </div>
            {policyResults.map((p) => (
              <button
                key={`${p.kind}:${p.policyId}:${p.label}`}
                type="button"
                className={cn(
                  "w-full text-right rounded-lg px-3 py-2 transition-colors",
                  "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelectPolicy(p.policyId);
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono ltr-nums font-medium text-sm text-foreground truncate">
                    {p.label}
                  </span>
                  {p.kind === "receipt" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                      سند
                    </span>
                  )}
                </div>
                {p.clientName && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {p.clientName}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-0.5">
            {policyResults.length > 0 && (
              <div className="px-2 pt-1 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                العملاء
              </div>
            )}
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                className={cn(
                  "w-full text-right rounded-lg px-3 py-2 transition-colors",
                  "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
                )}
                onMouseDown={(e) => {
                  // Use mouseDown to prevent input blur before navigation
                  e.preventDefault();
                  handleSelect(r.id, r.matchedCarId);
                }}
              >
                <div className="font-medium text-sm text-foreground truncate">
                  {r.full_name}
                </div>
                <div className="text-xs text-muted-foreground ltr-nums mt-0.5">
                  {r.id_number}
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

  // ─── Desktop: collapsed icon → inline input on click ────────────────
  if (collapsible && !isExpanded) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(true)}
          className={cn(
            "h-11 w-11 rounded-full bg-secondary/70 hover:bg-secondary text-foreground",
            "animate-in fade-in zoom-in-95 duration-200 ease-out",
            collapsedIconClassName,
            className,
          )}
          aria-label="بحث"
          title="بحث"
        >
          <Search className="h-[18px] w-[18px] text-foreground" />
        </Button>

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

  // ─── Desktop: inline input + dropdown ──────────────────────────────
  return (
    <>
    <div ref={containerRef} className={cn("relative flex items-center", className)}>
      {/* Input wrapper — `animate-in` only when we arrived here from the
          collapsed icon, so the input glides/scales in rather than
          snapping into place. */}
      <div
        className={cn(
          "relative",
          collapsible && "animate-in fade-in zoom-in-95 duration-200 ease-out",
        )}
      >
        {/* z-10 so the backdrop-blur on the input (which creates a
            stacking context) doesn't swallow the icon. */}
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/80 pointer-events-none z-10" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              clearSearch();
              if (collapsible) setIsExpanded(false);
            }
          }}
          placeholder="بحث..."
          className={cn(
            "h-9 w-[140px] sm:w-[200px] rounded-full pr-9 pl-8",
            "bg-background/70 border-border/50",
            // Kill the shadcn default focus ring + hover color swap —
            // the search input owns its own hover/focus treatment via
            // the glass bg below.
            "focus:ring-0 focus:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
            "hover:border-border/50 hover:bg-background/70",
            "transition-[width,border-radius,background-color,border-color] duration-300 ease-out",
            inputClassName,
            // When the dropdown is open the input morphs into the top
            // half of a single glass pill: flat bottom, no bottom
            // border, frosted bg that matches the dropdown, plus the
            // caller's wider size if provided.
            showDropdown && direction === "down" && [
              "rounded-b-none rounded-t-3xl",
              "border-b-transparent border-black/[0.06]",
              "bg-white/80 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70",
              "hover:bg-white/80",
              expandedInputClassName,
            ],
            showDropdown && direction === "up" && [
              "rounded-t-none rounded-b-3xl",
              "border-t-transparent border-black/[0.06]",
              "bg-white/80 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70",
              "hover:bg-white/80",
              expandedInputClassName,
            ],
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

      {/* Dropdown results — position + width follow the direction /
          matchWidth props so the same component serves the bottom
          toolbar (wide, upward) and the header (matched, downward,
          seamlessly attached to the input). */}
      {showDropdown && (
        <div
          className={cn(
            "absolute z-40 max-h-[380px] overflow-y-auto p-2",
            // Glass surface — matches the input's open state exactly so
            // they read as one continuous shape. supports-[] fallback
            // keeps it white-opaque where backdrop-filter isn't
            // available.
            "border border-black/[0.06] bg-white/80 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70",
            "shadow-2xl shadow-black/5",
            // Connect seamlessly to the input: no top/bottom gap, no
            // seam border, matching corner radius on the far side.
            direction === "up"
              ? "bottom-full mt-0 rounded-t-3xl rounded-b-none border-b-0 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-200 ease-out"
              : "top-full mt-0 rounded-b-3xl rounded-t-none border-t-0 animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-200 ease-out",
            dropdownMatchWidth
              ? "left-0 right-0"
              : "left-1/2 -translate-x-1/2 w-[min(92vw,400px)]",
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

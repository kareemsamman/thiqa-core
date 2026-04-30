import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, AlertCircle, CheckCircle2, Trash2, ShieldAlert } from "lucide-react";
import { NoIndex } from "@/components/seo/NoIndex";

// PayPal sandbox playground.
//
// Super-admin-only test page. Paste a Sandbox Client ID, configure
// amount/currency, click "Load PayPal SDK". The page injects the
// PayPal JS SDK, renders Smart Buttons, and shows the full
// createOrder + onApprove response so you can verify the integration
// shape before wiring it into real billing.
//
// Client ID + currency + amount are cached in localStorage so a
// reload (or hopping between tabs while dev-server HMR remounts)
// doesn't wipe what you typed. Client ID is *not* sensitive — it
// ships in the SDK URL the browser fetches anyway. Secrets are
// never entered here.

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: PayPalButtonsConfig) => { render: (selector: string | HTMLElement) => Promise<void> };
    };
  }
}

interface PayPalOrderActions {
  order: {
    create: (intent: { purchase_units: Array<{ amount: { value: string; currency_code: string } }> }) => Promise<string>;
    capture: () => Promise<unknown>;
  };
}

interface PayPalApprovalData {
  orderID: string;
  payerID?: string;
}

interface PayPalButtonsConfig {
  style?: { layout?: "vertical" | "horizontal"; color?: string; shape?: string; label?: string };
  createOrder: (data: unknown, actions: PayPalOrderActions) => Promise<string>;
  onApprove: (data: PayPalApprovalData, actions: PayPalOrderActions) => Promise<void>;
  onError?: (err: unknown) => void;
  onCancel?: (data: unknown) => void;
}

const SDK_SCRIPT_ID = "paypal-sdk-test";

// localStorage keys — kept narrow so we don't collide with anything.
const LS_CLIENT_ID = "paypal_test_client_id";
const LS_CURRENCY = "paypal_test_currency";
const LS_AMOUNT = "paypal_test_amount";

function readLocal(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    // Private-mode Safari can throw on getItem; fall back gracefully.
    return fallback;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — quota / private mode
  }
}

const CURRENCY_OPTIONS = [
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "ILS", label: "ILS — Israeli Shekel" },
];

type Status =
  | { kind: "idle" }
  | { kind: "loading-sdk" }
  | { kind: "ready" }
  | { kind: "approving"; orderID: string }
  | { kind: "captured"; result: unknown }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export default function PayPalTest() {
  const { user, isSuperAdmin, loading: authLoading } = useAuth();

  const [clientId, setClientId] = useState(() => readLocal(LS_CLIENT_ID, ""));
  const [currency, setCurrency] = useState(() => readLocal(LS_CURRENCY, "USD"));
  const [amount, setAmount] = useState(() => readLocal(LS_AMOUNT, "1.00"));

  // Persist config changes — debounced via React's batching since each
  // setState above already triggers a render.
  useEffect(() => writeLocal(LS_CLIENT_ID, clientId), [clientId]);
  useEffect(() => writeLocal(LS_CURRENCY, currency), [currency]);
  useEffect(() => writeLocal(LS_AMOUNT, amount), [amount]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [eventLog, setEventLog] = useState<Array<{ ts: string; event: string; payload?: unknown }>>([]);
  const buttonsContainerRef = useRef<HTMLDivElement | null>(null);

  const log = (event: string, payload?: unknown) => {
    setEventLog((prev) => [
      { ts: new Date().toISOString().split("T")[1].slice(0, 12), event, payload },
      ...prev,
    ].slice(0, 50));
  };

  // Reset SDK + buttons when the user changes Client ID or currency,
  // since the SDK script URL bakes both into its query string and
  // PayPal won't re-init buttons on stale globals.
  const reset = () => {
    const existing = document.getElementById(SDK_SCRIPT_ID);
    if (existing) existing.remove();
    if (window.paypal) delete window.paypal;
    if (buttonsContainerRef.current) buttonsContainerRef.current.innerHTML = "";
    setStatus({ kind: "idle" });
  };

  const loadSdk = async () => {
    if (!clientId.trim()) {
      setStatus({ kind: "error", message: "Client ID is required" });
      return;
    }

    reset();
    setStatus({ kind: "loading-sdk" });
    log("loading PayPal SDK", { clientId: `${clientId.slice(0, 6)}…`, currency });

    const script = document.createElement("script");
    script.id = SDK_SCRIPT_ID;
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId.trim())}&currency=${currency}&intent=capture&components=buttons`;
    script.async = true;

    script.onload = () => {
      log("SDK loaded");
      // Just flip status to "ready"; the useEffect below will render
      // the buttons once React has mounted the ref'd container div.
      // Calling renderButtons() synchronously here doesn't work —
      // buttonsContainerRef.current is still null because React
      // hasn't yet swapped from the loading spinner to the buttons
      // div.
      setStatus({ kind: "ready" });
    };
    script.onerror = () => {
      log("SDK failed to load");
      setStatus({
        kind: "error",
        message: "PayPal SDK failed to load — check the Client ID and that you're using a Sandbox key.",
      });
    };

    document.head.appendChild(script);
  };

  const renderButtons = () => {
    if (!window.paypal || !buttonsContainerRef.current) return;
    buttonsContainerRef.current.innerHTML = "";

    window.paypal
      .Buttons({
        style: { layout: "vertical", color: "blue", shape: "rect", label: "paypal" },
        createOrder: (_data, actions) => {
          log("createOrder", { amount, currency });
          return actions.order
            .create({
              purchase_units: [
                {
                  amount: { value: amount, currency_code: currency },
                },
              ],
            })
            .then((orderID) => {
              log("order created", { orderID });
              return orderID;
            });
        },
        onApprove: async (data, actions) => {
          setStatus({ kind: "approving", orderID: data.orderID });
          log("onApprove", data);
          try {
            const result = await actions.order.capture();
            log("capture result", result);
            setStatus({ kind: "captured", result });
          } catch (err) {
            log("capture error", err);
            setStatus({
              kind: "error",
              message: err instanceof Error ? err.message : "Capture failed",
            });
          }
        },
        onError: (err) => {
          log("onError", err);
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "PayPal error",
          });
        },
        onCancel: (data) => {
          log("onCancel", data);
          setStatus({ kind: "cancelled" });
        },
      })
      .render(buttonsContainerRef.current)
      .catch((err) => {
        log("button render failed", err);
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Button render failed",
        });
      });
  };

  // Render (or re-render) the buttons whenever:
  //  - status flips to "ready" — first paint after the SDK loads;
  //    the ref'd container div is now in the DOM.
  //  - amount changes — createOrder's closure captures the current
  //    amount, so we need fresh buttons after each edit.
  //  - currency changes — same reason. (Currency also forces an SDK
  //    reload via reset(), which flips status back to "loading-sdk"
  //    and then "ready", so this effect will fire again on the next
  //    "ready" transition.)
  // Captured / cancelled also re-render so the user can run a second
  // payment without reloading.
  useEffect(() => {
    if (
      status.kind === "ready" ||
      status.kind === "captured" ||
      status.kind === "cancelled"
    ) {
      renderButtons();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, status.kind]);

  if (authLoading) {
    return (
      <>
        <NoIndex />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </>
    );
  }

  if (!user || !isSuperAdmin) {
    return (
      <>
        <NoIndex />
        <div className="min-h-screen flex items-center justify-center bg-background p-4" dir="rtl">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
                <ShieldAlert className="h-6 w-6 text-destructive" />
              </div>
              <CardTitle className="text-center">صفحة محظورة</CardTitle>
              <CardDescription className="text-center">
                هذه الصفحة متاحة لإدارة ثقة فقط (Super Admin).
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <NoIndex />
      <div className="min-h-screen bg-muted/20 p-6 md:p-10" dir="ltr">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">PayPal Sandbox Playground</h1>
              <Badge variant="outline" className="bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300">
                Super Admin
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              Test PayPal Smart Buttons end-to-end before wiring them into real billing. Use a Sandbox Client ID — never paste a Live key here.
            </p>
          </div>

          {/* ── Config ───────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Configuration</CardTitle>
              <CardDescription>
                Get your Sandbox Client ID from{" "}
                <a
                  href="https://developer.paypal.com/dashboard/applications/sandbox"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  developer.paypal.com → Apps & Credentials → Sandbox
                </a>
                . Nothing on this page is persisted.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-3 space-y-1.5">
                <Label htmlFor="client-id">Sandbox Client ID</Label>
                <Input
                  id="client-id"
                  placeholder="AY7…"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger id="currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="flex items-end gap-2">
                <Button onClick={loadSdk} disabled={status.kind === "loading-sdk" || !clientId.trim()} className="flex-1">
                  {status.kind === "loading-sdk" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Loading…
                    </>
                  ) : (
                    "Load PayPal SDK"
                  )}
                </Button>
                <Button variant="outline" size="icon" onClick={reset} title="Reset">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Status banner ────────────────────────────────── */}
          {status.kind === "error" && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-destructive/40 bg-destructive/5">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-destructive mb-1">Error</div>
                <div className="text-foreground/80">{status.message}</div>
              </div>
            </div>
          )}

          {status.kind === "captured" && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">Payment captured</div>
                <div className="text-foreground/80">
                  Sandbox payment completed end-to-end. See the full capture payload below — that's what your webhook handler will need to parse.
                </div>
              </div>
            </div>
          )}

          {status.kind === "cancelled" && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-muted-foreground/30 bg-muted/30">
              <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm font-medium">User cancelled the payment in the PayPal popup.</div>
            </div>
          )}

          {/* ── Smart Buttons ────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Smart Buttons</CardTitle>
              <CardDescription>
                Click PayPal → log in with a Sandbox <strong>Personal</strong> account →
                approve. The popup will redirect through PayPal's sandbox; on
                approval you'll see the capture payload in the panels below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status.kind === "idle" ? (
                <div className="text-sm text-muted-foreground italic py-8 text-center border border-dashed rounded-lg">
                  Configure above and click "Load PayPal SDK" to render the buttons.
                </div>
              ) : status.kind === "loading-sdk" ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div ref={buttonsContainerRef} className="max-w-md mx-auto" />
              )}
            </CardContent>
          </Card>

          {/* ── Capture payload ──────────────────────────────── */}
          {status.kind === "captured" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Capture payload</CardTitle>
                <CardDescription>
                  This is the full <code className="font-mono text-xs">order.capture()</code> response from PayPal — store the order id, payer email, and capture id in your webhook handler.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="p-4 rounded-lg bg-muted/50 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(status.result, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {/* ── Event log ────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                Event log
                {eventLog.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setEventLog([])}>
                    Clear
                  </Button>
                )}
              </CardTitle>
              <CardDescription>
                Every callback fired by the PayPal SDK, newest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {eventLog.length === 0 ? (
                <div className="text-sm text-muted-foreground italic py-6 text-center">
                  No events yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {eventLog.map((entry, i) => (
                    <div key={i} className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-muted-foreground">{entry.ts}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {entry.event}
                        </Badge>
                      </div>
                      {entry.payload !== undefined && (
                        <pre className="ml-4 pl-3 border-l border-border text-[11px] font-mono text-muted-foreground overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(entry.payload, null, 2)}
                        </pre>
                      )}
                      {i < eventLog.length - 1 && <Separator className="mt-2" />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

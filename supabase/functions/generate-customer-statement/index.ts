// ============================================================
// generate-customer-statement
//
// "كشف حساب" — per-year customer statement, HTML on BunnyCDN.
//
// Scope:
//   • Header section: agent branding + customer info + year label.
//   • Transactions section: every policy whose start_date falls in
//     the selected year, grouped by car. Status (سارية / ملغية /
//     محولة / منتهية) is rendered alongside its reason — cancellation
//     reason, transfer notes (customer + office), or transfer
//     adjustment direction — so the customer never has to ask "why
//     does this look different".
//   • Ledger section: every receipts row whose receipt_date falls in
//     the year. That single table covers سند قبض / سند صرف / سند إلغاء
//     / إشعار دائن / إشعار مدين by joining receipt_type to a label,
//     posting to مدين or دائن based on direction, and chaining a
//     running balance.
//   • Totals: sum of year policy amounts, sum of year payments
//     collected, "تم تسديد X من Y".
//   • Overall debt note: if the customer still owes money across
//     ALL years (not just the selected one), a separate sentence
//     under the totals surfaces it. Same logic
//     ClientDetails.fetchPaymentSummary uses, so the two reconcile.
//
// Output:
//   PUT to BunnyCDN under receipts/{year}/{month}/statement_… and
//   return { statement_url } for the modal to render in an iframe.
// ============================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  getAgentBranding,
  resolveAgentId,
  DEFAULT_BRANDING,
  buildLogoHtml,
  type AgentBranding,
} from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StatementRequest {
  client_id: string;
  year: number;
}

// ──────────────────────────────────────────────────────────────
// Static labels
// ──────────────────────────────────────────────────────────────

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة ائتمان',
  visa_external: 'فيزا خارجي',
  transfer: 'تحويل بنكي',
  credit_card: 'بطاقة ائتمان',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  THIRD: 'ثالث',
  FULL: 'شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

// Per receipt_type, the user-facing voucher label rendered in the
// ledger's "البيان" column. credit_note can also be an inbound note
// to the agent ("إشعار مدين") when amount is negative, so we resolve
// that case at row time and not here.
const RECEIPT_TYPE_LABELS: Record<string, string> = {
  payment: 'سند قبض',
  cancellation: 'سند إلغاء',
  accident_fee: 'سند رسوم حادث',
  credit_note: 'إشعار دائن',
  disbursement: 'سند صرف',
};

// Bank registry mirrors src/lib/banks.ts. Branches print the bank's
// short Arabic name on cheque rows so the customer recognizes their
// own slip. Unknown codes fall back to the raw code.
const BANK_LABELS: Record<string, string> = {
  "10": "بنك لئومي",
  "11": "بنك ديسكونت",
  "12": "بنك هبوعليم",
  "13": "بنك إيغود",
  "14": "بنك أوتسار هحيال",
  "17": "بنك مركنتيل ديسكونت",
  "20": "بنك مزراحي طفحوت",
  "31": "البنك الدولي الأول لإسرائيل",
  "34": "البنك العربي الإسرائيلي",
  "38": "البنك التجاري الفلسطيني",
  "46": "بنك يهاف",
  "54": "بنك يروشاليم",
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

const escapeHtml = (s: string | null | undefined): string => {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatMoney = (amount: number): string => {
  return `₪${Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}`;
};

const getBankLabel = (code: string | null | undefined): string => {
  if (!code) return '';
  return BANK_LABELS[code] || `بنك ${code}`;
};

// Voucher numbers come in two shapes:
//   • payment / cancellation rows use the integer receipt_number column
//     and follow the legacy R{n}/{year} formatting.
//   • credit_note / disbursement rows use voucher_number text (already
//     formatted as "C12/2026" / "D12/2026" by the allocator).
// Older rows might still lack voucher_number, so we synthesize it from
// receipt_number + the type prefix as a safe fallback.
const formatVoucherNumber = (
  receiptType: string,
  voucherNumber: string | null,
  receiptNumber: number | null,
  receiptDate: string | null,
): string => {
  if (voucherNumber) return voucherNumber;
  if (!receiptNumber) return '—';
  const year = receiptDate ? new Date(receiptDate).getFullYear() : new Date().getFullYear();
  const prefix = receiptType === 'cancellation'
    ? 'R'
    : receiptType === 'credit_note'
      ? 'C'
      : receiptType === 'disbursement'
        ? 'D'
        : receiptType === 'accident_fee'
          ? 'A'
          : 'R';
  return `${prefix}${receiptNumber}/${year}`;
};

const getPolicyTypeLabel = (parent: string, child: string | null): string => {
  if (parent === 'THIRD_FULL' && child && POLICY_TYPE_LABELS[child]) {
    return POLICY_TYPE_LABELS[child];
  }
  return POLICY_TYPE_LABELS[parent] || parent;
};

// Direction rules for the ledger.
//
// Per the user's mental model, the "مدين / للعميل" column collects
// every event where money / credit goes TO the customer (whether
// cash actually moved or just a promise was recorded). The
// "دائن / من العميل" column collects every event where money came
// FROM the customer.
//
// • payment, accident_fee  → دائن (customer paid us / charge owed)
// • cancellation           → مدين (refused cheque → we owe him back)
// • disbursement           → مدين (we paid cash to customer)
// • credit_note            → مدين (we OWE / credited the customer —
//   same intent as سند صرف, just not yet paid out)
const isDebitForCustomer = (receiptType: string): boolean => {
  return (
    receiptType === 'cancellation' ||
    receiptType === 'disbursement' ||
    receiptType === 'credit_note'
  );
};

// ──────────────────────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id, year } = (await req.json()) as StatementRequest;

    if (!client_id || !year) {
      return new Response(
        JSON.stringify({ error: 'client_id و year مطلوبان' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Per memory: keep RPCs/edge-fn invocations as the caller. We
    // create the supabase client with the user JWT so RLS is what
    // gates row visibility — the agent only ever sees its own
    // customers' rows. Service-role fallbacks (e.g. for branding
    // resolution) explicitly bypass and are clearly scoped below.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Resolve agent context for branding + voucher prefixes.
    const { data: { user } } = await userClient.auth.getUser();
    const userId = user?.id ?? null;
    const agentId = userId ? await resolveAgentId(serviceClient, userId) : null;
    const branding = agentId
      ? await getAgentBranding(serviceClient, agentId)
      : DEFAULT_BRANDING;

    // ── Client + branch ───────────────────────────────────────
    const { data: client, error: clientErr } = await userClient
      .from('clients')
      .select(`
        id, full_name, id_number, phone_number, file_number, branch_id,
        branch:branches(name, name_ar)
      `)
      .eq('id', client_id)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) {
      return new Response(
        JSON.stringify({ error: 'العميل غير موجود' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // ── Year-scoped policies (by start_date) ──────────────────
    const { data: policiesRaw } = await userClient
      .from('policies')
      .select(`
        id, policy_number, document_number, policy_type_parent, policy_type_child,
        start_date, end_date, insurance_price, office_commission, profit,
        cancelled, transferred, group_id, notes, created_at,
        cancellation_note, cancellation_date,
        transferred_from_policy_id, transferred_car_number, transferred_to_car_number,
        car:cars(id, car_number, manufacturer_name, model),
        company:insurance_companies(name, name_ar)
      `)
      .eq('client_id', client_id)
      .gte('start_date', yearStart)
      .lte('start_date', yearEnd)
      .is('deleted_at', null)
      .order('start_date', { ascending: true });
    const policies = (policiesRaw || []) as any[];

    // Payments linked to these policies — used to compute "paid
    // against year-Y transactions" per-policy chips. Refused rows
    // are excluded from totals (they're surfaced separately in the
    // ledger via the matching cancellation receipt).
    const policyIds = policies.map((p) => p.id);
    const { data: paymentsRaw } = policyIds.length
      ? await userClient
          .from('policy_payments')
          .select('id, policy_id, amount, refused, payment_type')
          .in('policy_id', policyIds)
      : { data: [] as any[] } as any;
    const payments = (paymentsRaw || []) as any[];

    // Lookup: policy_id → policy type + office commission. Same
    // signature the ledger filter uses, so إجمالي المدفوع and the
    // ledger دائن totals stay in lockstep: only visa_external rows
    // tied to a zero-commission إلزامي policy are stripped (those
    // are the customer-paid-the-company-directly cases).
    const policyById = new Map<string, any>();
    for (const p of policies) policyById.set(p.id, p);
    const isPaymentElzamiPassthrough = (p: any): boolean => {
      if (p.payment_type !== 'visa_external') return false;
      const pol = policyById.get(p.policy_id);
      if (!pol) return false;
      return pol.policy_type_parent === 'ELZAMI' && Number(pol.office_commission || 0) <= 0;
    };

    const paidByPolicy = new Map<string, number>();
    for (const p of payments) {
      if (p.refused) continue;
      if (isPaymentElzamiPassthrough(p)) continue;
      paidByPolicy.set(p.policy_id, (paidByPolicy.get(p.policy_id) || 0) + Number(p.amount || 0));
    }

    // Transfer adjustments touching these policies — either as the
    // destination (new_policy_id) or the origin (policy_id). The
    // origin case lets us surface "محوّلة إلى سيارة X" + reason on a
    // transferred-out policy that's still rendered above, and the
    // destination case carries any fee owed by the customer plus its
    // notes onto the new policy.
    const { data: transfersRaw } = policyIds.length
      ? await userClient
          .from('policy_transfers')
          .select(`
            policy_id, new_policy_id, adjustment_amount, adjustment_type,
            note, office_note, adjustment_note,
            from_car:cars!policy_transfers_from_car_id_fkey(car_number),
            to_car:cars!policy_transfers_to_car_id_fkey(car_number)
          `)
          .or(`policy_id.in.(${policyIds.join(',')}),new_policy_id.in.(${policyIds.join(',')})`)
      : { data: [] as any[] } as any;
    // Index transfers by both the destination (where the fee + notes
    // attach) and the origin (where we surface the destination car).
    const transfersByDestPolicy = new Map<string, any>();
    const transfersByOriginPolicy = new Map<string, any>();
    for (const t of (transfersRaw || []) as any[]) {
      if (t.new_policy_id) transfersByDestPolicy.set(t.new_policy_id, t);
      if (t.policy_id) transfersByOriginPolicy.set(t.policy_id, t);
    }

    // Cancelled policies — pull cancellation reasons too. Reason
    // lives on the policy itself, but the linked cancellation receipt
    // also carries it.
    const cancelledPolicies = policies.filter((p) => p.cancelled);
    let cancellationReasonByPolicy = new Map<string, string>();
    if (cancelledPolicies.length > 0) {
      const cancelledIds = cancelledPolicies.map((p) => p.id);
      const { data: cancelRows } = await userClient
        .from('receipts')
        .select('policy_id, cancellation_reason, receipt_type')
        .in('policy_id', cancelledIds)
        .eq('receipt_type', 'cancellation');
      for (const r of (cancelRows || []) as any[]) {
        if (r.policy_id && r.cancellation_reason) {
          cancellationReasonByPolicy.set(r.policy_id, r.cancellation_reason);
        }
      }
    }

    // ── Year-scoped ledger (receipts by receipt_date) ─────────
    // The auto-create trigger on policy_payments (per migration
    // 20260511160000) inserts receipts WITHOUT setting client_id —
    // only policy_id is populated. So filtering by client_id alone
    // misses every legacy auto-created payment receipt for this
    // customer. We union two queries:
    //   1. Direct client_id match (covers credit notes, disbursements,
    //      and any backfilled rows).
    //   2. Fallback by policy_id IN client's policies (covers the
    //      auto-created payment + cancellation rows).
    // Deduped by id so a row that satisfies both filters appears once.
    const selectCols = `
      id, receipt_number, voucher_number, receipt_type, receipt_date,
      amount, payment_method, cheque_number, card_last_four, notes,
      cancellation_reason, cancels_receipt_id, car_number,
      policy_id, payment_id, client_settlement_id, wallet_transaction_id,
      client_id, created_at
    `;

    // Fetch the FULL set of policy ids ever owned by this client
    // (not just the year-scoped ones) so receipts paid in the year
    // against an out-of-year policy still surface. Same client, same
    // money — the kashf shouldn't drop them just because the policy
    // started in a different year.
    const { data: allClientPolicyRows } = await userClient
      .from('policies')
      .select('id')
      .eq('client_id', client_id)
      .is('deleted_at', null);
    const allClientPolicyIds = (allClientPolicyRows || []).map((p: any) => p.id);

    const [byClientIdRes, byPolicyIdRes] = await Promise.all([
      userClient
        .from('receipts')
        .select(selectCols)
        .eq('client_id', client_id)
        .gte('receipt_date', yearStart)
        .lte('receipt_date', yearEnd),
      allClientPolicyIds.length
        ? userClient
            .from('receipts')
            .select(selectCols)
            .in('policy_id', allClientPolicyIds)
            .gte('receipt_date', yearStart)
            .lte('receipt_date', yearEnd)
        : Promise.resolve({ data: [] }),
    ]);

    const seenReceiptIds = new Set<string>();
    const ledger: any[] = [];
    for (const row of [...(byClientIdRes.data || []), ...((byPolicyIdRes as any).data || [])]) {
      if (seenReceiptIds.has(row.id)) continue;
      seenReceiptIds.add(row.id);
      ledger.push(row);
    }
    ledger.sort((a, b) => {
      const dateCmp = new Date(a.receipt_date).getTime() - new Date(b.receipt_date).getTime();
      if (dateCmp !== 0) return dateCmp;
      return Number(a.receipt_number || 0) - Number(b.receipt_number || 0);
    });

    // ── policy_payments metadata (shared R-number + session key) ──
    // The user-facing R-number lives on policy_payments.receipt_number
    // (text like "R162/2026") and is SHARED across every payment row
    // in the same collection session — so a bulk سند قبض covering 3
    // cheques shows ONE number even though three policy_payments rows
    // exist. The receipts table by contrast has its own per-row SERIAL
    // (R786, R787, R788...) which is internal bookkeeping, not what
    // the customer expects to see.
    //
    // We also pull payment_session_id / batch_id here so the URL
    // resolver below can group rows from the same session under one
    // bulk receipt link instead of generating three single-row
    // receipts for one logical bulk.
    type PaymentMeta = {
      receipt_number_text: string | null;
      payment_session_id: string | null;
      batch_id: string | null;
      bank_code: string | null;
      branch_code: string | null;
      cheque_date: string | null;
      // The linked policy's type + commission. We need both to decide
      // whether a payment for an ELZAMI policy should land in the
      // kashf (only when there's office_commission attached — the
      // base price is paid externally and never enters the office's
      // books).
      policy_type_parent: string | null;
      policy_office_commission: number;
    };
    const allPaymentIds = ledger
      .filter((r: any) => r.payment_id)
      .map((r: any) => r.payment_id as string);
    const paymentMeta = new Map<string, PaymentMeta>();
    if (allPaymentIds.length > 0) {
      const { data: payMeta } = await userClient
        .from('policy_payments')
        .select(`
          id, receipt_number, payment_session_id, batch_id,
          bank_code, branch_code, cheque_date,
          policy:policies(policy_type_parent, office_commission)
        `)
        .in('id', allPaymentIds);
      for (const p of (payMeta || []) as any[]) {
        const linkedPolicy: any = Array.isArray(p.policy) ? p.policy[0] : p.policy;
        paymentMeta.set(p.id, {
          receipt_number_text: p.receipt_number ?? null,
          payment_session_id: p.payment_session_id ?? null,
          batch_id: p.batch_id ?? null,
          bank_code: p.bank_code ?? null,
          branch_code: p.branch_code ?? null,
          cheque_date: p.cheque_date ?? null,
          policy_type_parent: linkedPolicy?.policy_type_parent ?? null,
          policy_office_commission: Number(linkedPolicy?.office_commission ?? 0),
        });
      }
    }

    // Strip ledger rows that represent an إلزامي pass-through — the
    // customer paid the insurance company directly via external Visa
    // and the office only recorded the row for tracking. Those have
    // no place on the office's kashf. The signature is BOTH:
    //   • payment_method === 'visa_external' (the explicit
    //     marker the in-app receipts page tags as "فيزا خارجي"), AND
    //   • the linked policy is إلزامي with zero office commission.
    // Cash/cheque/transfer payments are NEVER stripped even if the
    // backend linked them to the package's إلزامي row by happenstance
    // (which happens when the bulk-payment flow attaches one cash
    // payment to a single policy_id picked from the package).
    const isElzamiPassthrough = (r: any): boolean => {
      if (r.payment_method !== 'visa_external') return false;
      const paymentId = r.payment_id;
      if (!paymentId) return false;
      const meta = paymentMeta.get(paymentId);
      if (!meta) return false;
      return meta.policy_type_parent === 'ELZAMI' && meta.policy_office_commission <= 0;
    };
    const filteredLedger = ledger.filter((r: any) => {
      if (r.receipt_type === 'payment' || r.receipt_type === 'cancellation') {
        return !isElzamiPassthrough(r);
      }
      return true;
    });
    // Rebind so the rest of the function works against the filtered
    // view. The outer year-totals computation below still uses the
    // unfiltered `ledger` because it gates on receipt_type, not
    // on payment linkage — refused-cheque cancellations and credit
    // notes against إلزامي are rare enough that we let them through.
    const ledgerForEvents = filteredLedger;
    // Back-compat alias — the renderer still calls this `chequeMeta`
    // for the cheque bank/branch/maturity sub-line. Same map, narrower
    // shape, no behavior change there.
    const chequeMeta = paymentMeta;

    // ── Per-row voucher URLs ──────────────────────────────────────
    // payment rows: group by (payment_session_id || batch_id ||
    //   payment_id) and call generate-bulk-payment-receipt ONCE for
    //   the whole session. Every row in the group shares that URL,
    //   so clicking R162/2026 on any of the 3 rows opens the same
    //   bulk سند the user knows from the receipts page.
    // cancellation / credit_note / disbursement: each is its own
    //   document — call the matching single-row generator.
    const functionsBase = `${supabaseUrl}/functions/v1`;
    const fnHeaders: Record<string, string> = {
      Authorization: authHeader,
      apikey: anonKey,
      'Content-Type': 'application/json',
    };
    const fetchVoucherUrl = async (fn: string, body: Record<string, unknown>): Promise<string | null> => {
      try {
        const resp = await fetch(`${functionsBase}/${fn}`, {
          method: 'POST',
          headers: fnHeaders,
          body: JSON.stringify(body),
        });
        if (!resp.ok) return null;
        const data = await resp.json().catch(() => null);
        return data?.receipt_url || data?.statement_url || null;
      } catch {
        return null;
      }
    };

    // Session key for a payment row — same fallback chain the bulk
    // receipt code uses, so we pin to identical groupings.
    const sessionKeyForPayment = (paymentId: string): string => {
      const meta = paymentMeta.get(paymentId);
      return meta?.payment_session_id || meta?.batch_id || paymentId;
    };

    // Group payment rows by session and gather payment_ids.
    const sessionToPaymentIds = new Map<string, string[]>();
    for (const r of ledgerForEvents as any[]) {
      if (r.receipt_type !== 'payment' || !r.payment_id) continue;
      const key = sessionKeyForPayment(r.payment_id);
      if (!sessionToPaymentIds.has(key)) sessionToPaymentIds.set(key, []);
      const arr = sessionToPaymentIds.get(key)!;
      if (!arr.includes(r.payment_id)) arr.push(r.payment_id);
    }

    // One bulk-receipt fetch per session, in parallel.
    const bulkUrlBySession = new Map<string, string>();
    const bulkPromises = Array.from(sessionToPaymentIds.entries()).map(async ([key, ids]) => {
      const url = await fetchVoucherUrl('generate-bulk-payment-receipt', { payment_ids: ids });
      return { key, url };
    });
    const bulkResults = await Promise.allSettled(bulkPromises);
    for (const r of bulkResults) {
      if (r.status === 'fulfilled' && r.value.url) {
        bulkUrlBySession.set(r.value.key, r.value.url);
      }
    }

    // Non-payment rows still resolve to their own single-row docs.
    const otherUrlPromises = (ledgerForEvents as any[]).map(async (r) => {
      let url: string | null = null;
      if (r.receipt_type === 'cancellation') {
        url = await fetchVoucherUrl('generate-cancellation-voucher', { voucher_receipt_id: r.id });
      } else if (r.receipt_type === 'credit_note') {
        url = await fetchVoucherUrl('generate-credit-note-voucher', { voucher_receipt_id: r.id });
      } else if (r.receipt_type === 'disbursement') {
        url = await fetchVoucherUrl('generate-disbursement-voucher', { voucher_receipt_id: r.id });
      }
      return { id: r.id as string, url };
    });
    const otherResults = await Promise.allSettled(otherUrlPromises);

    const voucherUrlByReceipt = new Map<string, string>();
    // Stamp every payment row with its session's bulk URL.
    for (const r of ledgerForEvents as any[]) {
      if (r.receipt_type === 'payment' && r.payment_id) {
        const url = bulkUrlBySession.get(sessionKeyForPayment(r.payment_id));
        if (url) voucherUrlByReceipt.set(r.id, url);
      }
    }
    for (const res of otherResults) {
      if (res.status === 'fulfilled' && res.value.url) {
        voucherUrlByReceipt.set(res.value.id, res.value.url);
      }
    }

    // ── Year totals ───────────────────────────────────────────
    // The "إجمالي معاملات السنة" follows the same rule the in-app
    // إجمالي معاملات — ALL transactions for the year, including
    // cancelled and transferred ones. Per the user: "بشطبش اشي لما
    // الغي" — cancelling is an agreement, not a deletion. The
    // cancelled transaction stays on the books at its original price
    // and the refund row (إشعار دائن / سند صرف) is what reverses it.
    // إلزامي base price is still excluded (paid directly to the
    // insurance company); only its office_commission contributes.
    const totalYearAmount = policies.reduce((s, p) => {
      const commission = Number(p.office_commission || 0);
      if (p.policy_type_parent === 'ELZAMI') return s + commission;
      return s + Number(p.insurance_price || 0) + commission;
    }, 0);

    // إجمالي المدفوع — gross cash collected from the customer
    // (excluding refused rows and إلزامي pass-through). Since the
    // cancelled transactions stay in totalYearAmount above, payments
    // that landed on them stay in totalYearPaid too — the balance
    // math nets them out symmetrically.
    const totalYearPaid = Array.from(paidByPolicy.values()).reduce((s, v) => s + v, 0);

    // إجمالي المرتجع — every refund the office issued back to the
    // customer this year, whether as a credit balance (إشعار دائن)
    // or actual cash out (سند صرف). Both subtract from what the
    // customer owes because both represent value returned.
    const yearCreditNoteAmount = ledger
      .filter((r) => r.receipt_type === 'credit_note')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const yearDisbursementAmount = ledger
      .filter((r) => r.receipt_type === 'disbursement')
      .reduce((s, r) => s + Math.abs(Number(r.amount || 0)), 0);
    const yearCustomerCredit = yearCreditNoteAmount + yearDisbursementAmount;

    // Year balance — signed so the kashf can flip direction:
    //   positive → customer still owes the office
    //   negative → office still owes the customer
    //   zero     → settled
    // Everything is gross now: every transaction (cancelled or not),
    // every payment, every refund. The cancellation/transfer rows
    // themselves are notation-only on the ledger, so the math has to
    // close out via the refund rows.
    const yearBalance = totalYearAmount - totalYearPaid - yearCustomerCredit;
    const totalYearRemaining = Math.max(0, yearBalance);
    const totalYearOwedToCustomer = Math.max(0, -yearBalance);

    // ── Overall remaining (across ALL years) ──────────────────
    // Pulled to render the "ملاحظة: العميل عليه إجمالاً ₪X" line at
    // the bottom of the statement — the customer always sees their
    // outstanding balance globally, not just the snapshot for the
    // year they picked.
    const { data: allPolicies } = await userClient
      .from('policies')
      .select('id, insurance_price, office_commission, cancelled, transferred')
      .eq('client_id', client_id)
      .is('deleted_at', null);
    const allActivePolicies = (allPolicies || []).filter(
      (p: any) => !p.cancelled && !p.transferred,
    );
    const totalAllOwed = allActivePolicies.reduce(
      (s: number, p: any) => s + Number(p.insurance_price || 0) + Number(p.office_commission || 0),
      0,
    );
    const allActiveIds = allActivePolicies.map((p: any) => p.id);
    let totalAllPaid = 0;
    if (allActiveIds.length > 0) {
      const { data: allPays } = await userClient
        .from('policy_payments')
        .select('amount, refused')
        .in('policy_id', allActiveIds);
      totalAllPaid = (allPays || [])
        .filter((p: any) => !p.refused)
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
    }

    // Wallet balance (refunds owed vs adjustments due) — used to
    // net the overall remaining number.
    //
    // weOweCustomer = (refund-type wallet entries) − (disbursements
    // already paid out). Without the disbursement subtraction, a
    // cancellation that was followed by a سند صرف still leaves
    // the wallet credit "outstanding" in the bottom-note math, so
    // the kashf advertises "office owes customer ₪500" long after
    // the office has actually settled it. The user's mental model
    // is one global wallet: every disbursement reduces what we
    // owe, regardless of which cancellation it was tagged against.
    const { data: walletRows } = await userClient
      .from('customer_wallet_transactions')
      .select('amount, transaction_type')
      .eq('client_id', client_id);
    let weOweCustomer = 0;
    let customerOwesUs = 0;
    for (const w of (walletRows || []) as any[]) {
      const t = w.transaction_type;
      const amt = Number(w.amount || 0);
      if (t === 'refund' || t === 'transfer_refund_owed' || t === 'manual_refund') {
        weOweCustomer += amt;
      } else if (t === 'transfer_adjustment_due') {
        customerOwesUs += amt;
      }
    }
    // Subtract every disbursement (سند صرف) the office has issued
    // — those are cash payouts that fulfill refund obligations.
    const { data: allDisbursements } = await userClient
      .from('receipts')
      .select('id, amount, client_id, policy_id')
      .eq('receipt_type', 'disbursement')
      .or(
        allClientPolicyIds.length
          ? `client_id.eq.${client_id},policy_id.in.(${allClientPolicyIds.join(',')})`
          : `client_id.eq.${client_id}`,
      );
    const seenDisbIds = new Set<string>();
    let totalDisbursed = 0;
    for (const d of (allDisbursements || []) as any[]) {
      if (seenDisbIds.has(d.id)) continue;
      seenDisbIds.add(d.id);
      totalDisbursed += Math.abs(Number(d.amount || 0));
    }
    weOweCustomer = Math.max(0, weOweCustomer - totalDisbursed);
    const overallRemaining = Math.max(0, totalAllOwed - totalAllPaid);
    const overallNet = overallRemaining + customerOwesUs - weOweCustomer;
    // Positive → customer owes us. Negative → we owe customer.

    // ── Render HTML ───────────────────────────────────────────
    const html = buildStatementHtml({
      client,
      year,
      policies,
      transfersByDestPolicy,
      transfersByOriginPolicy,
      cancellationReasonByPolicy,
      paidByPolicy,
      ledger: ledgerForEvents,
      chequeMeta,
      voucherUrlByReceipt,
      totalYearAmount,
      totalYearPaid,
      yearCustomerCredit,
      totalYearRemaining,
      totalYearOwedToCustomer,
      overallNet,
      branding,
    });

    // ── Upload to BunnyCDN ────────────────────────────────────
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL');

    if (!bunnyApiKey || !bunnyStorageZone || !bunnyCdnUrl) {
      // Fallback: return the HTML inline if CDN isn't configured
      // (matches the bulk-receipt function's fallback so the modal
      // still has something to render in local dev).
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const safeName = (client.full_name || 'customer')
      .replace(/[^a-zA-Z0-9؀-ۿ]/g, '_')
      .slice(0, 40);
    const storagePath = `statements/${yyyy}/${mm}/kashf_${safeName}_${year}_${timestamp}_${randomId}.html`;

    const uploadResponse = await fetch(
      `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`,
      {
        method: 'PUT',
        headers: {
          AccessKey: bunnyApiKey,
          'Content-Type': 'text/html; charset=utf-8',
        },
        body: html,
      },
    );

    if (!uploadResponse.ok) {
      console.error('[generate-customer-statement] Bunny upload failed', uploadResponse.status);
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    const statementUrl = `${bunnyCdnUrl}/${storagePath}`;
    return new Response(
      JSON.stringify({
        success: true,
        statement_url: statementUrl,
        year,
        total_year_amount: totalYearAmount,
        total_year_paid: totalYearPaid,
        total_year_remaining: totalYearRemaining,
        overall_net: overallNet,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    console.error('[generate-customer-statement] Fatal error:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

// ──────────────────────────────────────────────────────────────
// HTML builder
// ──────────────────────────────────────────────────────────────

interface BuildArgs {
  client: any;
  year: number;
  policies: any[];
  transfersByDestPolicy: Map<string, any>;
  transfersByOriginPolicy: Map<string, any>;
  cancellationReasonByPolicy: Map<string, string>;
  paidByPolicy: Map<string, number>;
  ledger: any[];
  chequeMeta: Map<string, {
    bank_code: string | null;
    branch_code: string | null;
    cheque_date: string | null;
    receipt_number_text: string | null;
    payment_session_id: string | null;
    batch_id: string | null;
  }>;
  voucherUrlByReceipt: Map<string, string>;
  totalYearAmount: number;
  totalYearPaid: number;
  yearCustomerCredit: number;
  totalYearRemaining: number;
  totalYearOwedToCustomer: number;
  overallNet: number;
  branding: AgentBranding;
}

// Mirrors src/lib/packageDocumentNumber.ts — picks the canonical
// رقم المعاملة for a group of policies. THIRD_FULL wins over ELZAMI
// wins over addons. Ties break on the smallest document_number so
// repeated calls return the same value.
function pickPackageDocumentNumber(
  policies: { document_number?: string | null; policy_type_parent?: string | null }[],
): string | null {
  const TYPE_RANK: Record<string, number> = { THIRD_FULL: 0, ELZAMI: 1 };
  const stamped = policies
    .filter((p): p is { document_number: string; policy_type_parent: string | null } =>
      typeof p.document_number === 'string' && p.document_number.trim().length > 0,
    )
    .map((p) => ({
      doc: p.document_number.trim(),
      rank: TYPE_RANK[p.policy_type_parent ?? ''] ?? 99,
    }));
  if (stamped.length === 0) return null;
  stamped.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.doc.localeCompare(b.doc, 'en', { numeric: true });
  });
  return stamped[0].doc;
}

function buildStatementHtml(args: BuildArgs): string {
  const {
    client,
    year,
    policies,
    transfersByDestPolicy,
    transfersByOriginPolicy,
    cancellationReasonByPolicy,
    paidByPolicy,
    ledger,
    chequeMeta,
    voucherUrlByReceipt,
    totalYearAmount,
    totalYearPaid,
    yearCustomerCredit,
    totalYearRemaining,
    totalYearOwedToCustomer,
    overallNet,
    branding,
  } = args;

  // ── Header meta block ────────────────────────────────────────
  // Prefer the Arabic branch name so a customer reading the kashf
  // doesn't see "Al-Tireh Insurance" next to their Arabic data.
  const branchName = client.branch?.name_ar || client.branch?.name || '—';
  const logoHtml = buildLogoHtml(branding);
  const phonesHtml = (branding.invoicePhones || [])
    .filter(Boolean)
    .map((p) => `<a href="tel:${escapeHtml(p)}">${escapeHtml(p)}</a>`)
    .join(' / ');
  const contactLines: string[] = [];
  if (phonesHtml) contactLines.push(`هاتف: ${phonesHtml}`);
  if (branding.invoiceAddress) contactLines.push(`عنوان: ${escapeHtml(branding.invoiceAddress)}`);
  const contactFooterHtml = contactLines.length
    ? `<div class="contact">${contactLines.join(' · ')}</div>`
    : '';

  // ── Build unified event ledger ─────────────────────────────
  // The accountant's request: ONE table that follows صندوق rules —
  // money flows in (مدين), money flows out (دائن), running balance.
  // Each event is a row:
  //   • Transaction created (active policy/package)            → مدين
  //   • Transaction reversed (cancellation or transfer of a
  //     previously billed package)                              → دائن
  //   • Payment received (سند قبض)                              → دائن
  //   • Payment voided (refused cheque → سند إلغاء)             → مدين
  //   • Credit note issued (إشعار دائن)                         → دائن
  //   • Disbursement paid out (سند صرف)                         → مدين
  //   • Accident fee billed                                     → مدين
  //
  // For mixed packages (ثالث + إلزامي), the كشف shows the office's
  // share AND the إلزامي share inside the same row but keeps the
  // total math intact — the customer reads "ثالث 3000 + إلزامي 1500"
  // separately, but مدين still totals 4500 so adding everything up
  // reconciles with the in-app debt tile.
  type LedgerEvent = {
    date: string;
    // Fine-grained timestamp (ms-since-epoch) from the underlying
    // row's created_at. We use this as the PRIMARY tiebreaker when
    // multiple events share the same calendar date, so a payment
    // posted between two same-day transactions actually lands
    // between them in the printed kashf instead of getting bumped
    // to the bottom by the type-bucket sortKey.
    timestamp: number;
    sortKey: number; // last-resort tiebreaker: 0=transaction, 1=reversal, 2=receipt
    voucherNumber: string;
    voucherUrl: string | null;
    description: string;
    subLines: string[];
    debit: number;
    credit: number;
    // Signed contribution to the running balance, computed at event
    // build time. For most events balanceDelta = debit − credit, but
    // for إشعار دائن the row sits in the مدين column visually (per
    // the user's rule "same column as سند صرف") while still
    // SUBTRACTING from the customer's outstanding — the office owes
    // him that amount, so the balance has to dip.
    balanceDelta: number;
    rowClass: string;
    directionHint: string;
  };

  const events: LedgerEvent[] = [];

  // 1. Transaction events from policies (one per group_id package)
  const packageMap = new Map<string, any[]>();
  const singletons: any[] = [];
  for (const p of policies) {
    if (p.group_id) {
      if (!packageMap.has(p.group_id)) packageMap.set(p.group_id, []);
      packageMap.get(p.group_id)!.push(p);
    } else {
      singletons.push(p);
    }
  }
  const allPackages: any[][] = [
    ...Array.from(packageMap.values()),
    ...singletons.map((p) => [p]),
  ];

  for (const pkg of allPackages) {
    const docNumber =
      pickPackageDocumentNumber(pkg) ||
      pkg[0].document_number ||
      pkg[0].policy_number ||
      '—';
    const mainPolicy =
      pkg.find((p) => p.policy_type_parent === 'THIRD_FULL') ||
      pkg.find((p) => p.policy_type_parent === 'ELZAMI') ||
      pkg[0];

    // Each policy in the package gets its own line under البيان so
    // the customer sees exactly what he bought. For إلزامي rows we
    // still display the policy and its base price (so a glance at
    // the kashf tells the customer that إلزامي is part of the deal),
    // but the base price is NOT added to officePart — the customer
    // paid that to the insurance company directly via external Visa,
    // so it never enters the office's books. Office commission on
    // an إلزامي row (rare, e.g. when the agent charges for handling
    // إلزامي-only) does enter officePart.
    let officePart = 0;
    const lineItems: string[] = [];
    for (const p of pkg) {
      const insurancePrice = Number(p.insurance_price || 0);
      const commission = Number(p.office_commission || 0);
      const typeLabel = getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child);
      const companyName = p.company?.name_ar || p.company?.name || '';
      const companyTag = companyName ? ` · ${escapeHtml(companyName)}` : '';
      if (p.policy_type_parent === 'ELZAMI') {
        // Show the إلزامي line item with its base price + a "خارج
        // الكشف" tag so the customer reads what it covers. Office
        // commission (if any) joins the office's books inline.
        const commissionNote = commission > 0
          ? ` <span class="commission-note">(+ ${formatMoney(commission)} عمولة مكتب)</span>`
          : '';
        lineItems.push(
          `<div class="line-item"><span class="line-amount">${formatMoney(insurancePrice)}</span> · <strong>${escapeHtml(typeLabel)}</strong>${companyTag}<span class="elzami-tag">تدفع للشركة — خارج الكشف</span>${commissionNote}</div>`,
        );
        officePart += commission;
      } else {
        officePart += insurancePrice + commission;
        const breakdownTag = commission > 0
          ? ` <span class="commission-note">(منها ${formatMoney(commission)} عمولة مكتب)</span>`
          : '';
        lineItems.push(
          `<div class="line-item"><span class="line-amount">${formatMoney(insurancePrice + commission)}</span> · <strong>${escapeHtml(typeLabel)}</strong>${companyTag}${breakdownTag}</div>`,
        );
      }
    }

    const totalDebit = officePart;
    const carNumber = mainPolicy.car?.car_number;
    const period = `${formatDate(mainPolicy.start_date)} ← ${formatDate(mainPolicy.end_date)}`;

    // The transaction row stays "clean" — exactly as it was when
    // first entered. Cancellation, transfer-out, refused-cheque
    // cancellation, credit notes, and disbursements all surface as
    // their OWN rows further down the ledger. Per the user's rule:
    // "ما لازم تعدل على نفس ال ROW" — don't mutate the original row,
    // append new ones. This reads chronologically like a story:
    // "transaction created → paid → cancelled → refund issued →
    // refund paid out".
    //
    // The one annotation we keep is "محوّلة من سيارة X" when THIS
    // package is the destination of a transfer — that's how the
    // customer recognizes the new policy as a continuation of the
    // previous one.
    const reasonLines: string[] = [];
    for (const p of pkg) {
      if (!p.transferred_from_policy_id) continue;
      const adj = transfersByDestPolicy.get(p.id);
      const fromCar = adj?.from_car?.car_number || p.transferred_car_number;
      reasonLines.push(
        `<span class="reason-transfer-in"><strong>محوّلة${fromCar ? ` من سيارة ${escapeHtml(fromCar)}` : ''}</strong>${adj?.note ? ` — ${escapeHtml(adj.note)}` : ''}</span>`,
      );
      if (adj && Number(adj.adjustment_amount || 0) > 0) {
        const dir = adj.adjustment_type === 'customer_pays' ? 'فرق على العميل' : 'فرق للعميل';
        reasonLines.push(
          `<span class="reason-adjust"><strong>${dir}:</strong> ${formatMoney(Number(adj.adjustment_amount))}${adj.adjustment_note ? ` — ${escapeHtml(adj.adjustment_note)}` : ''}</span>`,
        );
      }
    }

    const headlineParts: string[] = [];
    headlineParts.push('<strong>معاملة جديدة</strong>');
    if (carNumber) headlineParts.push(`سيارة ${escapeHtml(carNumber)}`);
    headlineParts.push(period);
    const description = `<div class="event-headline">${headlineParts.join(' · ')}</div>`;

    const subLines: string[] = [...lineItems];
    for (const r of reasonLines) subLines.push(`<div class="reason-line">${r}</div>`);

    // Earliest creation timestamp in the package — this is when the
    // package was actually entered in the system, so events stamped
    // a few seconds later (the customer's same-day payment) sort
    // correctly after the transaction row.
    const pkgCreatedAt = pkg.reduce<number>((min, p) => {
      const t = p.created_at ? new Date(p.created_at).getTime() : Number.MAX_SAFE_INTEGER;
      return Number.isNaN(t) ? min : Math.min(min, t);
    }, Number.MAX_SAFE_INTEGER);
    const pkgTimestamp = Number.isFinite(pkgCreatedAt) && pkgCreatedAt !== Number.MAX_SAFE_INTEGER
      ? pkgCreatedAt
      : new Date(mainPolicy.start_date).getTime();

    events.push({
      date: mainPolicy.start_date,
      timestamp: pkgTimestamp,
      sortKey: 0,
      voucherNumber: String(docNumber),
      voucherUrl: null, // transactions don't have a printable HTML voucher yet
      description,
      subLines,
      debit: totalDebit,
      credit: 0,
      balanceDelta: totalDebit, // bill the customer
      rowClass: 'event-transaction',
      directionHint: 'مستحق على العميل',
    });

    // 2. Reversal event for cancelled / transferred packages.
    //
    // Per the user's rule: cancelling a transaction does NOT mean
    // returning the full amount. The customer USED part of the
    // insurance up to the cancellation date — that "used" portion
    // is legitimately owed to the office and stays. Only the
    // unpaid-and-unused part is forgiven here; the paid-but-unused
    // part is represented by a separate إشعار دائن (credit_note) row.
    //
    // The reversal row also carries the cancellation/transfer
    // REASON — those used to clutter the transaction row above, but
    // the user wants the original transaction row to stay clean. So
    // every "what happened" detail now lives here, in chronological
    // order beneath the original.
    const packageInactive = mainPolicy.cancelled || mainPolicy.transferred;
    if (packageInactive) {
      const reversalDate =
        (mainPolicy.cancelled && mainPolicy.cancellation_date) ||
        mainPolicy.start_date;

      // policies.cancellation_date is a DATE column (no time), so
      // parsing it gives midnight 00:00:00 — which sorts BEFORE every
      // payment of the same day. To keep the cancellation row in its
      // natural chronological place (right alongside the إشعار دائن /
      // سند صرف it produced), pair it with the linked credit_note or
      // disbursement and use that row's created_at minus a tick.
      // Fall back to end-of-day for cancellations that haven't (yet)
      // produced a paired receipt.
      let linkedNote: any = null;
      for (const r of ledger as any[]) {
        if (!pkg.some((p) => p.id === r.policy_id)) continue;
        if (r.receipt_type === 'credit_note' || r.receipt_type === 'disbursement') {
          if (!linkedNote) { linkedNote = r; break; }
        }
      }
      const reversalTimestamp = linkedNote?.created_at
        ? new Date(linkedNote.created_at).getTime() - 1
        : (() => {
            const d = new Date(reversalDate);
            if (Number.isNaN(d.getTime())) return pkgTimestamp;
            d.setHours(23, 59, 59, 999);
            return d.getTime();
          })();

      const reasonSubLines: string[] = [];
      if (mainPolicy.cancelled) {
        const reason =
          mainPolicy.cancellation_note ||
          cancellationReasonByPolicy.get(mainPolicy.id) ||
          'بدون سبب محدد';
        reasonSubLines.push(`<div class="reason-line reason-cancel"><strong>سبب الإلغاء:</strong> ${escapeHtml(reason)}</div>`);
      }
      if (mainPolicy.transferred) {
        const transferOut = transfersByOriginPolicy.get(mainPolicy.id);
        const toCar = transferOut?.to_car?.car_number || mainPolicy.transferred_to_car_number;
        reasonSubLines.push(
          `<div class="reason-line reason-transfer"><strong>محوّلة${toCar ? ` إلى سيارة ${escapeHtml(toCar)}` : ''}</strong>${transferOut?.note ? ` — ${escapeHtml(transferOut.note)}` : ''}</div>`,
        );
      }
      // The original transaction price stays informational on the
      // reversal row so a customer reading the kashf sees the value
      // of "what was cancelled" without scrolling back to the
      // معاملة جديدة line above. Balance is still unaffected.
      if (totalDebit > 0.01) {
        reasonSubLines.push(
          `<div class="reason-line"><strong>سعر الإلغاء:</strong> ${formatMoney(totalDebit)}</div>`,
        );
      }
      // Cancellation/transfer is a NOTATION ONLY — no balance impact,
      // no debit/credit. The actual money movement is carried by the
      // linked إشعار دائن (credit_note) and/or سند صرف (disbursement)
      // rows that follow. The original transaction row stays as-is in
      // the customer's debt, and the refund row(s) subtract from it
      // separately — that's how the office's real-world workflow runs:
      // cancellation is an agreement, refund is the cash event.
      const reversalLabel = mainPolicy.cancelled ? 'إلغاء معاملة' : 'تحويل معاملة';
      events.push({
        date: reversalDate,
        timestamp: Number.isNaN(reversalTimestamp) ? pkgTimestamp : reversalTimestamp,
        sortKey: 1,
        voucherNumber: String(docNumber),
        voucherUrl: null,
        description: `<div class="event-headline"><strong>${reversalLabel}</strong> · رقم ${escapeHtml(String(docNumber))}</div>`,
        subLines: reasonSubLines,
        debit: 0,
        credit: 0,
        balanceDelta: 0,
        rowClass: 'event-reversal',
        directionHint: 'ملاحظة',
      });
    }
  }

  // 3. Receipt events (from receipts table)
  //
  // The تسديد المبلغ flow saves ONE physical instrument (one cheque,
  // one cash collection, one Visa charge) as N policy_payments rows
  // — one per policy the money is allocated across. The auto-trigger
  // then mirrors each policy_payment into a receipts row. Without
  // grouping, a single ₪1,000 cheque covering two policies (e.g.
  // ₪750 ثالث + ₪250 خدمات الطريق) would print as TWO separate
  // ₪750 + ₪250 cheque rows in the kashf, which is exactly what the
  // user flagged. We collapse rows back into one event per physical
  // instrument by keying on (session, method, cheque#-or-card-last4).
  type ReceiptGroupKey = string;
  const groupKeyFor = (r: any): ReceiptGroupKey | null => {
    // Only payment-type rows get bucketed. Every payment row in the
    // same session collapses into ONE ledger entry — one سند قبض =
    // one row, regardless of how many cheques / cash splits / cards
    // it contains. The user doesn't want per-payment-instrument
    // detail on the kashf; the bulk receipt voucher carries those.
    // Cancellations / credit notes / disbursements stay as their
    // own events because each represents a distinct accounting
    // transaction.
    if (r.receipt_type !== 'payment') return null;
    const meta = r.payment_id ? chequeMeta.get(r.payment_id) : null;
    const sessionKey = meta?.payment_session_id || meta?.batch_id || r.payment_id || r.id;
    return `session:${sessionKey}`;
  };

  type ReceiptGroup = { representative: any; rows: any[]; totalAmount: number };
  const paymentGroups = new Map<ReceiptGroupKey, ReceiptGroup>();
  const standaloneReceipts: any[] = [];
  for (const r of ledger) {
    const key = groupKeyFor(r);
    if (!key) {
      standaloneReceipts.push(r);
      continue;
    }
    const existing = paymentGroups.get(key);
    if (existing) {
      existing.rows.push(r);
      existing.totalAmount += Math.abs(Number(r.amount || 0));
      // Earliest created_at wins as the representative — that's the
      // moment the physical instrument hit the office's books.
      const cur = existing.representative.created_at
        ? new Date(existing.representative.created_at).getTime()
        : Infinity;
      const cand = r.created_at ? new Date(r.created_at).getTime() : Infinity;
      if (cand < cur) existing.representative = r;
    } else {
      paymentGroups.set(key, {
        representative: r,
        rows: [r],
        totalAmount: Math.abs(Number(r.amount || 0)),
      });
    }
  }

  const emitReceiptEvent = (r: any, displayedAmount: number, isMergedGroup = false) => {
    const isDebit = isDebitForCustomer(r.receipt_type);
    let typeLabel = RECEIPT_TYPE_LABELS[r.receipt_type] || r.receipt_type;
    if (r.receipt_type === 'credit_note' && Number(r.amount) < 0) {
      typeLabel = 'إشعار مدين';
    }
    const methodLabel = PAYMENT_TYPE_LABELS[r.payment_method] || r.payment_method || '';

    const sharedReceiptText = (r.receipt_type === 'payment' && r.payment_id)
      ? chequeMeta.get(r.payment_id)?.receipt_number_text ?? null
      : null;
    const voucherNumber =
      sharedReceiptText ||
      formatVoucherNumber(r.receipt_type, r.voucher_number, r.receipt_number, r.receipt_date);

    // Per the user: a سند قبض that bundles several instruments
    // (cheque + cash, two cheques, etc.) prints ONE line with the
    // total — no per-instrument detail. The bulk receipt voucher
    // (R…/year) linked from the row carries those if needed. We
    // only surface cheque metadata / card last4 for SINGLE-row
    // payments and for non-payment receipts (cancellation, credit
    // note, disbursement) — each of which is its own document.
    const detailLines: string[] = [];
    if (!isMergedGroup) {
      if (r.payment_method === 'cheque') {
        const meta = r.payment_id ? chequeMeta.get(r.payment_id) : null;
        const chequeNumStr = r.cheque_number ? `شيك #${escapeHtml(r.cheque_number)}` : '';
        const bankLabel = getBankLabel(meta?.bank_code);
        const branchLabel = meta?.branch_code ? `فرع ${escapeHtml(meta.branch_code)}` : '';
        const dueDate = meta?.cheque_date ? `استحقاق: ${formatDate(meta.cheque_date)}` : '';
        const chequeLine = [chequeNumStr, bankLabel, branchLabel, dueDate].filter(Boolean).join(' · ');
        if (chequeLine) detailLines.push(`<div class="ledger-detail">${chequeLine}</div>`);
      } else if (r.payment_method === 'visa' || r.payment_method === 'credit_card' || r.payment_method === 'visa_external') {
        if (r.card_last_four) detailLines.push(`<div class="ledger-detail">بطاقة تنتهي بـ ${escapeHtml(r.card_last_four)}</div>`);
      }
    }
    if (r.cancellation_reason) {
      detailLines.push(`<div class="reason-line reason-cancel"><strong>سبب الإلغاء:</strong> ${escapeHtml(r.cancellation_reason)}</div>`);
    }
    if (r.notes) {
      detailLines.push(`<div class="ledger-detail">${escapeHtml(r.notes)}</div>`);
    }

    // Description: when a payment session merged multiple methods
    // we drop the specific method label — "سند قبض" alone with the
    // bundled total. For everything else show "<type> · <method>"
    // as before.
    const description = `<div class="event-headline"><strong>${escapeHtml(typeLabel)}</strong>${(!isMergedGroup && methodLabel) ? ` · ${escapeHtml(methodLabel)}` : ''}</div>`;

    const directionHint = (() => {
      switch (r.receipt_type) {
        case 'cancellation': return 'إلغاء سند قبض سابق';
        case 'disbursement': return 'استلمه العميل';
        case 'credit_note': return 'رصيد للعميل';
        case 'accident_fee': return 'استحق على العميل';
        default: return 'دفعه العميل';
      }
    })();

    const rowClass = (() => {
      switch (r.receipt_type) {
        case 'cancellation': return 'event-cancel-receipt';
        case 'disbursement': return 'event-disbursement';
        case 'credit_note': return 'event-credit-note';
        default: return 'event-payment';
      }
    })();

    const receiptTimestamp = r.created_at
      ? new Date(r.created_at).getTime()
      : new Date(r.receipt_date).getTime();
    // Per-event balance contribution, decoupled from the display
    // column. Both credit_note and disbursement sit in the مدين column
    // visually but SUBTRACT from the running balance — the office is
    // giving value back to the customer (a paper credit or cash out),
    // so the balance has to dip when it lands. Cancellation rows
    // (إلغاء معاملة) carry no balance impact themselves — the refund
    // row that follows them is what actually moves the number.
    const balanceDelta = (() => {
      switch (r.receipt_type) {
        case 'payment':       return -displayedAmount; // customer paid
        case 'accident_fee':  return -displayedAmount; // billed as payment-like
        case 'cancellation':  return +displayedAmount; // refused cheque puts debt back
        case 'disbursement':  return -displayedAmount; // cash paid out to customer
        case 'credit_note':   return -displayedAmount; // office owes customer
        default:              return isDebit ? +displayedAmount : -displayedAmount;
      }
    })();
    events.push({
      date: r.receipt_date,
      timestamp: Number.isNaN(receiptTimestamp) ? 0 : receiptTimestamp,
      sortKey: 2,
      voucherNumber,
      voucherUrl: voucherUrlByReceipt.get(r.id) || null,
      description,
      subLines: detailLines,
      debit: isDebit ? displayedAmount : 0,
      credit: isDebit ? 0 : displayedAmount,
      balanceDelta,
      rowClass,
      directionHint,
    });
  };

  // Emit one event per physical-instrument group, using the SUM of
  // its split rows as the amount. Sub-row notes vary rarely (the UI
  // captures one note per instrument), so the representative's
  // notes cell carries the full text without losing information.
  for (const group of paymentGroups.values()) {
    emitReceiptEvent(group.representative, group.totalAmount, group.rows.length > 1);
  }
  // Non-payment receipts (cancellation / credit_note / disbursement
  // / accident_fee) emit per-row because each one represents a
  // distinct accounting transaction.
  for (const r of standaloneReceipts) {
    emitReceiptEvent(r, Math.abs(Number(r.amount || 0)));
  }

  // 4. Sort by actual created_at timestamp (fine-grained), then by
  // displayed date (fallback when timestamps are missing/equal), then
  // by event kind (last-resort tiebreaker). Putting timestamp first
  // ensures a payment posted between two same-day transactions sorts
  // between them — not bumped to the bottom by the type bucket.
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    const dCmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dCmp !== 0) return dCmp;
    return a.sortKey - b.sortKey;
  });

  // 5. Render unified table with running balance
  let running = 0;
  const unifiedRowsHtml = events.map((e) => {
    running += e.balanceDelta;
    const debitCell = e.debit > 0
      ? `<span class="amt-debit">${formatMoney(e.debit)}</span>`
      : '';
    const creditCell = e.credit > 0
      ? `<span class="amt-credit">${formatMoney(e.credit)}</span>`
      : '';
    const balanceCell = running === 0
      ? '<span class="amt-balance-zero">0</span>'
      : running > 0
        ? `<span class="amt-balance-debt">${formatMoney(running)}</span>`
        : `<span class="amt-balance-credit">(${formatMoney(Math.abs(running))})</span>`;

    const numCell = e.voucherUrl
      ? `<a href="${e.voucherUrl}" target="_blank" rel="noopener noreferrer" class="vnum-link">${escapeHtml(e.voucherNumber)}</a>`
      : escapeHtml(e.voucherNumber);

    const subLinesHtml = e.subLines.length ? `<div class="event-sublines">${e.subLines.join('')}</div>` : '';

    return `
      <tr class="${e.rowClass}">
        <td class="vnum">${numCell}</td>
        <td class="date">${formatDate(e.date)}</td>
        <td class="event-cell">
          ${e.description}
          ${subLinesHtml}
        </td>
        <td class="amount debit">${debitCell}</td>
        <td class="amount credit">${creditCell}</td>
        <td class="amount balance">${balanceCell}</td>
      </tr>
    `;
  }).join('');

  const carsHtml = ''; // packages now live in the unified ledger above
  const ledgerRowsHtml = unifiedRowsHtml;

  const emptyLedgerHtml = events.length === 0
    ? `<tr><td colspan="6" class="ledger-empty">لا توجد حركات في هذه السنة</td></tr>`
    : '';

  // ── Totals + overall note ───────────────────────────────────
  // Layout matches the in-app debt tile so a customer cross-checking
  // sees identical arithmetic: إجمالي معاملات − المدفوع − المرتجع =
  // المتبقي. The "مرتجع" line only renders when there's actually a
  // customer credit for the year — otherwise the row is suppressed
  // so the totals stay compact for the common case.
  const showCreditLine = yearCustomerCredit > 0.01;
  const creditRowHtml = showCreditLine
    ? `
        <div class="totals-row totals-credit-row">
          <span class="totals-label">
            المرتجع (رصيد للعميل)
            <span class="totals-hint">— مبلغ أصدره المكتب باسمك من إلغاءات / تحويلات</span>
          </span>
          <span class="totals-value credit">−${formatMoney(yearCustomerCredit)}</span>
        </div>`
    : '';
  const totalsHtml = `
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row">
          <span class="totals-label">إجمالي معاملات ${year}</span>
          <span class="totals-value">${formatMoney(totalYearAmount)}</span>
        </div>
        <div class="totals-row">
          <span class="totals-label">إجمالي المدفوع لسنة ${year}</span>
          <span class="totals-value paid">+${formatMoney(totalYearPaid)}</span>
        </div>
        ${creditRowHtml}
        <div class="totals-row totals-final">
          ${totalYearRemaining > 0.01
            ? `
              <span class="totals-label">المتبقي على العميل لسنة ${year}</span>
              <span class="totals-value owed">${formatMoney(totalYearRemaining)}</span>
            `
            : totalYearOwedToCustomer > 0.01
              ? `
                <span class="totals-label">للعميل عند المكتب لسنة ${year}</span>
                <span class="totals-value owed-to-customer">${formatMoney(totalYearOwedToCustomer)}</span>
              `
              : `
                <span class="totals-label">المتبقي على العميل لسنة ${year}</span>
                <span class="totals-value cleared">تم التسديد بالكامل</span>
              `}
        </div>
      </div>
    </div>
  `;

  let overallNoteHtml = '';
  if (overallNet > 0.01) {
    overallNoteHtml = `
      <div class="overall-note overall-debt">
        <strong>ملاحظة:</strong> على العميل بشكل عام (لجميع السنوات) مبلغ <strong>${formatMoney(overallNet)}</strong>
      </div>
    `;
  } else if (overallNet < -0.01) {
    overallNoteHtml = `
      <div class="overall-note overall-credit">
        <strong>ملاحظة:</strong> للعميل رصيد دائن لدى المكتب بقيمة <strong>${formatMoney(Math.abs(overallNet))}</strong>
      </div>
    `;
  }

  // ── Final HTML ──────────────────────────────────────────────
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>كشف حساب ${year} - ${escapeHtml(client.full_name || 'عميل')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 0; }
    @media print {
      html, body { background: #ffffff; }
      body { padding: 10mm 8mm; }
      .no-print { display: none !important; }
    }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.55;
      color: #1a1a1a;
      background: #f4f4f5;
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .sheet {
      max-width: 880px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #1a1a1a;
      padding: 28px 30px;
    }

    /* Header */
    .sheet-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      padding-bottom: 18px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 22px;
    }
    .brand { max-width: 340px; }
    .brand img { max-height: 70px; max-width: 200px; margin-bottom: 8px; display: block; }
    .brand .name { font-size: 16px; font-weight: 800; color: #1a1a1a; }
    .brand .tax { font-size: 11.5px; color: #1a1a1a; margin-top: 2px; direction: ltr; text-align: right; font-weight: 500; }
    .brand .address { font-size: 11.5px; color: #1a1a1a; margin-top: 6px; line-height: 1.55; font-weight: 500; }
    .doc-meta { text-align: left; min-width: 240px; }
    .doc-meta .title {
      font-size: 32px; font-weight: 800; letter-spacing: 0.4px;
      color: #1a1a1a; line-height: 1.1; margin-bottom: 4px;
    }
    .doc-meta .year-line {
      font-size: 18px; font-weight: 800; color: #455ebb;
      direction: ltr; text-align: left; font-variant-numeric: tabular-nums;
      letter-spacing: 0.5px;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 11.5px; margin-top: 14px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 100px; padding: 6px 10px;
      background: #f4f4f5; font-weight: 700; color: #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .meta-rows .val {
      flex: 1; padding: 6px 10px;
      text-align: left; direction: ltr;
      font-weight: 700; color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    /* Customer card */
    .customer { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 1.2px; text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 12px; }
    .customer-grid .cell:not(:nth-child(4n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+5) { border-top: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 0.3px; margin-bottom: 3px; opacity: 0.75;
    }
    .customer-grid .value { font-size: 12.5px; font-weight: 700; color: #1a1a1a; }

    /* Cars + transactions */
    .car-section { margin-bottom: 18px; border: 1px solid #1a1a1a; }
    .car-header {
      padding: 8px 14px;
      background: #1a1a1a;
      color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 0.5px;
    }
    .policies-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5px;
    }
    .policies-table thead th {
      background: #f4f4f5; color: #1a1a1a;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.8px; padding: 8px 10px;
      text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .policies-table thead th:last-child { border-left: none; }
    .policies-table tbody td {
      padding: 9px 10px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      vertical-align: top;
    }
    .policies-table tbody td:last-child { border-left: none; }
    .policies-table .type-line { font-size: 12px; font-weight: 700; }
    .policies-table .type-sub { font-size: 11px; color: #555; margin-top: 2px; font-weight: 500; }
    .policies-table td.amount, .policies-table td.doc, .policies-table td.period {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .policies-table td.amount { white-space: nowrap; }
    .policies-table .inactive-row td { background: #fafafa; color: #555; }
    .policies-table .row-reason {
      font-size: 10.5px; color: #6b1f1f;
      background: #fef2f2; border-right: 3px solid #b91c1c;
      padding: 4px 8px; margin-top: 4px;
      border-radius: 0 4px 4px 0;
    }
    .policies-table .row-reason-warn {
      color: #7c2d12; background: #fff7ed; border-right-color: #ea580c;
    }
    .policies-table .row-reason-info {
      color: #1e3a8a; background: #eff6ff; border-right-color: #2563eb;
    }
    .status {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 1px 7px; border-radius: 10px; margin-right: 6px;
      letter-spacing: 0.3px;
    }
    .status-active { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .status-cancelled { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .status-transferred { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
    .status-ended { background: #e5e7eb; color: #374151; border: 1px solid #9ca3af; }
    .paid-pill {
      display: inline-block; font-size: 10px; font-weight: 700;
      padding: 1px 8px; border-radius: 10px;
      background: #dcfce7; color: #166534; border: 1px solid #86efac;
    }

    /* Ledger */
    .ledger { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .ledger-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    .ledger-table thead th {
      background: #f4f4f5; color: #1a1a1a;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.8px; padding: 9px 10px;
      text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .ledger-table thead th:last-child { border-left: none; }
    .ledger-table tbody td {
      padding: 9px 10px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      vertical-align: top;
    }
    .ledger-table tbody td:last-child { border-left: none; }
    .ledger-table td.vnum, .ledger-table td.amount, .ledger-table td.date {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
    }
    .ledger-table td.amount { white-space: nowrap; }
    .ledger-table td.balance { font-weight: 800; }
    .ledger-table .amt-credit {
      color: #15803d; font-weight: 800;
    }
    .ledger-table .amt-debit {
      color: #b91c1c; font-weight: 800;
    }
    .ledger-table .amt-balance-debt { color: #b91c1c; }
    .ledger-table .amt-balance-credit { color: #15803d; }
    .ledger-table .th-main {
      display: block; font-size: 11px; font-weight: 800;
      letter-spacing: 0.4px; color: #1a1a1a;
    }
    .ledger-table .th-sub {
      display: block; font-size: 9.5px; font-weight: 600;
      color: #6b7280; margin-top: 1px;
    }
    .ledger-table .ledger-direction {
      display: inline-block; margin-right: 6px;
      font-size: 9.5px; font-weight: 600;
      padding: 1px 7px; border-radius: 8px;
      letter-spacing: 0.2px;
    }
    .ledger-table .direction-credit {
      background: #dcfce7; color: #166534; border: 1px solid #86efac;
    }
    .ledger-table .direction-debit {
      background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5;
    }
    /* Unified event ledger — per-row tint so the customer scans by color */
    .ledger-table .event-transaction td       { background: #fffefb; }
    .ledger-table .event-inactive td          { background: #fafafa; opacity: 0.78; }
    .ledger-table .event-reversal td          { background: #fff7ed; }
    .ledger-table .event-payment td           { background: #f0fdf4; }
    .ledger-table .event-credit-note td       { background: #fef2f2; }
    .ledger-table .event-disbursement td      { background: #fef2f2; }
    .ledger-table .event-cancel-receipt td    { background: #fef2f2; }
    .ledger-table .event-headline {
      font-size: 12.5px; font-weight: 700; color: #1a1a1a;
      line-height: 1.5;
    }
    .ledger-table .event-sublines {
      margin-top: 4px; font-size: 11px; color: #374151;
      line-height: 1.6; font-weight: 500;
    }
    .ledger-table .line-item {
      padding: 2px 0; display: flex; gap: 6px;
      align-items: baseline; flex-wrap: wrap;
    }
    .ledger-table .line-item .line-amount {
      display: inline-block; min-width: 70px;
      font-variant-numeric: tabular-nums;
      font-weight: 700; color: #1a1a1a;
      direction: ltr; text-align: left;
    }
    .ledger-table .elzami-tag {
      display: inline-block; font-size: 9.5px; font-weight: 700;
      padding: 1px 6px; border-radius: 8px;
      background: #fef3c7; color: #92400e; border: 1px solid #fcd34d;
    }
    .ledger-table .commission-note {
      font-size: 10px; color: #6b7280; font-weight: 500;
    }
    .ledger-table .elzami-summary {
      font-size: 10.5px; color: #6b7280; font-weight: 600;
      padding: 4px 8px; background: #fafafa;
      border-right: 2px solid #d1d5db; margin-top: 4px;
      border-radius: 0 4px 4px 0;
    }
    .ledger-table .reason-line {
      font-size: 10.5px; padding: 3px 8px; margin-top: 3px;
      border-radius: 0 4px 4px 0; line-height: 1.55;
    }
    .ledger-table .reason-cancel {
      background: #fef2f2; color: #7f1d1d;
      border-right: 3px solid #b91c1c;
    }
    .ledger-table .reason-transfer {
      background: #fff7ed; color: #7c2d12;
      border-right: 3px solid #ea580c;
    }
    .ledger-table .reason-transfer-in {
      background: #eff6ff; color: #1e3a8a;
      border-right: 3px solid #2563eb;
    }
    .ledger-table .reason-adjust {
      background: #f5f3ff; color: #5b21b6;
      border-right: 3px solid #7c3aed;
    }
    .ledger-table .amt-balance-zero {
      color: #6b7280; font-weight: 700;
    }
    .ledger-table .vnum-link {
      color: #1d4ed8; text-decoration: none;
      border-bottom: 1px dashed #1d4ed8;
    }
    .ledger-table .vnum-link:hover { color: #1e40af; border-bottom-style: solid; }
    @media print {
      .ledger-table .vnum-link {
        color: #1a1a1a; border-bottom: none;
      }
    }
    .ledger-table .ledger-type { font-size: 12px; font-weight: 700; }
    .ledger-table .ledger-detail {
      font-size: 10.5px; color: #555; margin-top: 3px;
      font-weight: 500; line-height: 1.5;
    }
    .ledger-table .ledger-empty {
      text-align: center; padding: 24px 12px;
      color: #6b7280; font-style: italic;
    }
    .ledger-legend {
      display: flex; flex-wrap: wrap; gap: 14px;
      padding: 8px 14px; background: #fafafa;
      border-bottom: 1px solid #1a1a1a;
      font-size: 11px; font-weight: 600; color: #1a1a1a;
    }
    .ledger-legend .legend-item {
      display: inline-flex; align-items: center; gap: 5px;
    }
    .ledger-legend .legend-dot {
      width: 9px; height: 9px; border-radius: 50%; display: inline-block;
    }
    .ledger-legend .legend-credit { background: #16a34a; }
    .ledger-legend .legend-debit { background: #dc2626; }
    .ledger-legend .legend-note {
      color: #6b7280; font-weight: 500;
      margin-right: auto;
    }

    /* Totals */
    .totals { display: flex; justify-content: flex-end; margin-bottom: 14px; }
    .totals-box {
      min-width: 360px; border: 2px solid #1a1a1a;
      background: #ffffff;
    }
    .totals-row {
      display: flex; justify-content: space-between;
      padding: 9px 14px;
      border-bottom: 1px solid #1a1a1a;
    }
    .totals-row:last-child { border-bottom: none; }
    .totals-row.totals-final {
      background: #1a1a1a; color: #ffffff;
      font-weight: 800; font-size: 14px;
    }
    .totals-label { font-weight: 700; font-size: 12px; }
    .totals-value {
      font-weight: 800; font-size: 13px;
      direction: ltr; font-variant-numeric: tabular-nums;
    }
    .totals-value.paid { color: #166534; }
    .totals-value.credit { color: #b45309; }
    .totals-row.totals-final .totals-value { font-size: 15px; }
    .totals-value.cleared { color: #86efac; }
    .totals-value.owed { color: #fca5a5; }
    .totals-value.owed-to-customer { color: #fcd34d; }
    .totals-row.totals-credit-row { background: #fffbeb; }
    .totals-hint {
      display: block; font-size: 10px; font-weight: 500;
      color: #6b7280; margin-top: 2px;
    }

    /* Overall note */
    .overall-note {
      margin-bottom: 18px; padding: 12px 16px;
      border-radius: 6px; font-size: 12.5px;
      line-height: 1.6;
    }
    .overall-note.overall-debt {
      background: #fef2f2; border: 1px solid #b91c1c; color: #7f1d1d;
    }
    .overall-note.overall-credit {
      background: #ecfdf5; border: 1px solid #047857; color: #065f46;
    }

    /* Footer */
    .footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid #1a1a1a; }
    .contact { font-size: 11px; color: #1a1a1a; font-weight: 500; }
    .contact a { color: #1a1a1a; text-decoration: none; }
    .legalese {
      font-size: 10.5px; color: #6b7280; margin-top: 8px;
      line-height: 1.6; font-weight: 500;
    }

    /* Floating action bar (preview only) */
    .actions {
      position: fixed; bottom: 20px; left: 50%;
      transform: translateX(-50%);
      background: #1a1a1a; color: #ffffff;
      padding: 10px 16px; border-radius: 999px;
      display: flex; gap: 8px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
    }
    .actions button {
      background: transparent; border: none; color: inherit;
      font: inherit; cursor: pointer;
      padding: 6px 14px; border-radius: 999px;
    }
    .actions button:hover { background: rgba(255,255,255,0.15); }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="sheet-top">
      <div class="brand">
        ${logoHtml}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${branding.taxNumber ? `<div class="tax">${escapeHtml(branding.taxNumber)}</div>` : ''}
        ${branding.invoiceAddress ? `<div class="address">${escapeHtml(branding.invoiceAddress)}</div>` : ''}
      </div>
      <div class="doc-meta">
        <div class="title">كشف حساب</div>
        <div class="year-line">السنة: ${year}</div>
        <div class="meta-rows">
          <div class="row"><div class="label">تاريخ الإصدار</div><div class="val">${formatDate(new Date().toISOString())}</div></div>
          <div class="row"><div class="label">الفرع</div><div class="val" style="text-align:right;direction:rtl">${escapeHtml(branchName)}</div></div>
        </div>
      </div>
    </div>

    <div class="customer">
      <div class="section-title">معلومات العميل</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">الاسم</div>
          <div class="value">${escapeHtml(client.full_name || '—')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value" dir="ltr">${escapeHtml(client.id_number || '—')}</div>
        </div>
        <div class="cell">
          <div class="label">الهاتف</div>
          <div class="value" dir="ltr">${escapeHtml(client.phone_number || '—')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الملف</div>
          <div class="value" dir="ltr">${escapeHtml(client.file_number || '—')}</div>
        </div>
      </div>
    </div>

    <div class="ledger">
      <div class="section-title">كشف الحركة (${year})</div>
      <div class="ledger-legend">
        <span class="legend-item"><span class="legend-dot legend-debit"></span>مدين — يضاف لما على العميل (معاملة جديدة / سند صرف)</span>
        <span class="legend-item"><span class="legend-dot legend-credit"></span>دائن — يطرح من ما على العميل (سند قبض / إشعار دائن / إلغاء معاملة)</span>
        <span class="legend-item legend-note">اضغط على رقم السند لعرض الوثيقة الأصلية</span>
      </div>
      <table class="ledger-table">
        <thead>
          <tr>
            <th style="width:90px">رقم السند</th>
            <th style="width:85px">التاريخ</th>
            <th>البيان</th>
            <th style="width:100px">
              <span class="th-main">للعميل</span>
              <span class="th-sub">مدين (−)</span>
            </th>
            <th style="width:100px">
              <span class="th-main">من العميل</span>
              <span class="th-sub">دائن (+)</span>
            </th>
            <th style="width:110px">الرصيد</th>
          </tr>
        </thead>
        <tbody>${ledgerRowsHtml}${emptyLedgerHtml}</tbody>
      </table>
    </div>

    ${totalsHtml}
    ${overallNoteHtml}

    <div class="footer">
      ${contactFooterHtml}
      <div class="legalese">
        كشف الحساب هذا مُولّد آلياً ويعكس الحركات حتى تاريخ الإصدار. للاستفسار يُرجى التواصل مع المكتب.
      </div>
    </div>
  </div>

  <div class="actions no-print" id="floating-actions">
    <button onclick="window.print()">🖨️ طباعة</button>
    <button onclick="tryCloseWindow()">✕ إغلاق</button>
  </div>
  <script>
    // When the kashf is loaded inside the modal iframe, the host
    // already provides its own print/close/SMS/WhatsApp bar — the
    // floating duplicate at the bottom just gets in the way (and
    // its window.close() is blocked by the browser for iframes).
    // Drop it entirely in that context.
    if (window.self !== window.top) {
      var bar = document.getElementById('floating-actions');
      if (bar) bar.remove();
    }
    // Standalone tab: window.close() works only if this tab was
    // script-opened. As a fallback we hide the bar so the user
    // gets visual feedback instead of nothing.
    function tryCloseWindow() {
      try { window.close(); } catch (_) {}
      setTimeout(function () {
        var bar = document.getElementById('floating-actions');
        if (bar) bar.style.display = 'none';
      }, 100);
    }
  </script>
</body>
</html>`;
}

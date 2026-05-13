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

// Direction rules for the ledger:
//   • payment, accident_fee, credit_note (positive)  → دائن (the
//     customer paid us / we created credit for him).
//   • cancellation, disbursement                     → مدين (we
//     reversed money to him).
// This matches how the in-app Receipts page calculates running
// balance — keep them in lockstep so the customer's printed kashf
// can be sanity-checked against the screen.
const isDebitForCustomer = (receiptType: string): boolean => {
  return receiptType === 'cancellation' || receiptType === 'disbursement';
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
        branch:branches(name)
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
        cancelled, transferred, group_id, notes,
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
          .select('id, policy_id, amount, refused')
          .in('policy_id', policyIds)
      : { data: [] as any[] } as any;
    const payments = (paymentsRaw || []) as any[];

    const paidByPolicy = new Map<string, number>();
    for (const p of payments) {
      if (p.refused) continue;
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
      client_id
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

    // Lookup table: bank/branch on the underlying cheque row for any
    // cheque-method receipt in the ledger. The receipts row itself
    // only carries the cheque_number, so we fetch the matched
    // policy_payments row to enrich the "البيان" cell with bank info.
    const chequePaymentIds = ledger
      .filter((r) => r.payment_method === 'cheque' && r.payment_id)
      .map((r) => r.payment_id);
    const chequeMeta = new Map<string, { bank_code: string | null; branch_code: string | null; cheque_date: string | null }>();
    if (chequePaymentIds.length > 0) {
      const { data: payMeta } = await userClient
        .from('policy_payments')
        .select('id, bank_code, branch_code, cheque_date')
        .in('id', chequePaymentIds);
      for (const p of (payMeta || []) as any[]) {
        chequeMeta.set(p.id, {
          bank_code: p.bank_code ?? null,
          branch_code: p.branch_code ?? null,
          cheque_date: p.cheque_date ?? null,
        });
      }
    }

    // ── Year totals ───────────────────────────────────────────
    // The "إجمالي معاملات السنة" follows the same rule the in-app
    // money-card uses: insurance_price + office_commission for
    // every non-cancelled, non-transferred policy in the year. The
    // cancelled / transferred ones are still rendered above but
    // excluded from the totals so the customer reads "تم تسديد X
    // من Y" against the active obligations only.
    const totalYearAmount = policies
      .filter((p) => !p.cancelled && !p.transferred)
      .reduce((s, p) => s + Number(p.insurance_price || 0) + Number(p.office_commission || 0), 0);

    // Paid in the year — sum non-refused policy_payments for the
    // year's policies. We deliberately compute from policy_payments
    // (not from the ledger of receipts) so the number matches the
    // in-app "إجمالي المدفوع" tile exactly: net of refused rows, and
    // unaffected by the cancellation-receipt double-entries that
    // sit in the ledger for audit purposes.
    const totalYearPaid = Array.from(paidByPolicy.values()).reduce((s, v) => s + v, 0);

    const totalYearRemaining = Math.max(0, totalYearAmount - totalYearPaid);

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
    // net the overall remaining number, same as the in-app card.
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
      ledger,
      chequeMeta,
      totalYearAmount,
      totalYearPaid,
      totalYearRemaining,
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
  ledger: any[];
  chequeMeta: Map<string, { bank_code: string | null; branch_code: string | null; cheque_date: string | null }>;
  totalYearAmount: number;
  totalYearPaid: number;
  totalYearRemaining: number;
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
    ledger,
    chequeMeta,
    totalYearAmount,
    totalYearPaid,
    totalYearRemaining,
    overallNet,
    branding,
  } = args;

  // ── Header meta block ────────────────────────────────────────
  const branchName = client.branch?.name || '—';
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

  // ── Policies grouped by car ─────────────────────────────────
  type PolicyGroup = { carKey: string; carLabel: string; items: any[] };
  const byCar = new Map<string, PolicyGroup>();
  for (const p of policies) {
    const key = p.car?.id || '__nocar__';
    const label = p.car
      ? [p.car.car_number, p.car.manufacturer_name, p.car.model].filter(Boolean).join(' · ')
      : 'بدون سيارة';
    if (!byCar.has(key)) byCar.set(key, { carKey: key, carLabel: label, items: [] });
    byCar.get(key)!.items.push(p);
  }

  // Within each car bucket, collapse policies that share a group_id
  // into ONE row (a "package" / "معاملة"). Standalone policies stay
  // as a single-policy package. This matches how the in-app UI shows
  // a معاملة card — one row per رقم المعاملة, with the included
  // policies listed inside the description cell.
  type PackageRow = {
    docNumber: string;
    policies: any[];
    mainPolicy: any;
    period: { start: string; end: string };
    totalPrice: number;
  };

  const carsHtml = Array.from(byCar.values()).map((group) => {
    const packageMap = new Map<string, any[]>();
    const singletons: any[] = [];
    for (const p of group.items) {
      if (p.group_id) {
        if (!packageMap.has(p.group_id)) packageMap.set(p.group_id, []);
        packageMap.get(p.group_id)!.push(p);
      } else {
        singletons.push(p);
      }
    }
    const rows: PackageRow[] = [];
    for (const [, pkg] of packageMap) {
      const docNumber =
        pickPackageDocumentNumber(pkg) ||
        pkg[0].document_number ||
        pkg[0].policy_number ||
        '—';
      const mainPolicy =
        pkg.find((p) => p.policy_type_parent === 'THIRD_FULL') ||
        pkg.find((p) => p.policy_type_parent === 'ELZAMI') ||
        pkg[0];
      const totalPrice = pkg.reduce(
        (s, p) => s + Number(p.insurance_price || 0) + Number(p.office_commission || 0),
        0,
      );
      rows.push({
        docNumber: String(docNumber),
        policies: pkg,
        mainPolicy,
        period: { start: mainPolicy.start_date, end: mainPolicy.end_date },
        totalPrice,
      });
    }
    for (const p of singletons) {
      rows.push({
        docNumber: String(p.document_number || p.policy_number || '—'),
        policies: [p],
        mainPolicy: p,
        period: { start: p.start_date, end: p.end_date },
        totalPrice: Number(p.insurance_price || 0) + Number(p.office_commission || 0),
      });
    }
    // Newest transaction first — matches the in-app order the user
    // showed (149 → 140 → 138 → 139 → 137).
    rows.sort((a, b) => b.docNumber.localeCompare(a.docNumber, 'en', { numeric: true }));

    const rowsHtml = rows.map((row) => {
      const main = row.mainPolicy;
      // Status badges — a policy can be BOTH transferred and cancelled
      // (transferred then later cancelled), so we collect every state
      // that applies instead of returning the first match.
      const badges: string[] = [];
      if (main.cancelled) badges.push(`<span class="status status-cancelled">ملغية</span>`);
      if (main.transferred) badges.push(`<span class="status status-transferred">محوّلة</span>`);
      if (!main.cancelled && !main.transferred) {
        if (new Date(main.end_date) < new Date()) {
          badges.push(`<span class="status status-ended">منتهية</span>`);
        } else {
          badges.push(`<span class="status status-active">سارية</span>`);
        }
      }

      // Policy-type list: "إلزامي + ثالث" with each company name in
      // the sub-line so the customer sees who the insurer is per piece.
      const typeList = row.policies
        .map((p) => getPolicyTypeLabel(p.policy_type_parent, p.policy_type_child))
        .join(' + ');
      const companyNames = Array.from(
        new Set(
          row.policies
            .map((p) => p.company?.name_ar || p.company?.name)
            .filter((x): x is string => !!x),
        ),
      );
      const companyLine = companyNames.length ? companyNames.join(' · ') : '—';

      // Reason blocks: cancellation, transfer-out (to car X), transfer-in
      // (from car Y), and any monetary adjustment with its customer note.
      const reasonBlocks: string[] = [];

      if (main.cancelled) {
        const reason =
          main.cancellation_note ||
          cancellationReasonByPolicy.get(main.id) ||
          'بدون سبب محدد';
        const cancelDate = main.cancellation_date ? ` · ${formatDate(main.cancellation_date)}` : '';
        reasonBlocks.push(
          `<div class="row-reason"><strong>سبب الإلغاء${cancelDate}:</strong> ${escapeHtml(reason)}</div>`,
        );
      }

      // Transferred OUT — destination car from policy_transfers (origin
      // side). transferred_to_car_number on the policy itself is a
      // denormalized fallback.
      if (main.transferred) {
        const transferOut = transfersByOriginPolicy.get(main.id);
        const toCar =
          transferOut?.to_car?.car_number ||
          main.transferred_to_car_number ||
          null;
        const carLabel = toCar ? ` (سيارة ${escapeHtml(toCar)})` : '';
        reasonBlocks.push(
          `<div class="row-reason row-reason-warn"><strong>محوّلة إلى:</strong>${carLabel}</div>`,
        );
        if (transferOut?.note) {
          reasonBlocks.push(
            `<div class="row-reason row-reason-warn"><strong>سبب التحويل:</strong> ${escapeHtml(transferOut.note)}</div>`,
          );
        }
      }

      // Transferred IN — origin car from any policy in this package
      // that has transferred_from_policy_id. Same data, viewed from
      // the destination side.
      for (const p of row.policies) {
        if (!p.transferred_from_policy_id) continue;
        const adj = transfersByDestPolicy.get(p.id);
        const fromCar = adj?.from_car?.car_number || p.transferred_car_number || null;
        const carLabel = fromCar ? ` (سيارة ${escapeHtml(fromCar)})` : '';
        reasonBlocks.push(
          `<div class="row-reason row-reason-info"><strong>محوّلة من:</strong>${carLabel}</div>`,
        );
        if (adj?.note) {
          reasonBlocks.push(
            `<div class="row-reason row-reason-info"><strong>سبب التحويل:</strong> ${escapeHtml(adj.note)}</div>`,
          );
        }
        if (adj && Number(adj.adjustment_amount || 0) > 0) {
          const isCustomerPays = adj.adjustment_type === 'customer_pays';
          const dir = isCustomerPays ? 'فرق على العميل' : 'فرق للعميل';
          reasonBlocks.push(
            `<div class="row-reason row-reason-info"><strong>${dir}:</strong> ${formatMoney(Number(adj.adjustment_amount))}</div>`,
          );
          if (adj.adjustment_note) {
            reasonBlocks.push(
              `<div class="row-reason row-reason-info"><strong>تفاصيل الفرق:</strong> ${escapeHtml(adj.adjustment_note)}</div>`,
            );
          }
        }
      }

      const isInactive = main.cancelled || main.transferred;
      const period = `${formatDate(row.period.start)} ← ${formatDate(row.period.end)}`;

      return `
        <tr class="${isInactive ? 'inactive-row' : ''}">
          <td class="policy-type">
            <div class="type-line"><strong>${escapeHtml(typeList)}</strong> ${badges.join('')}</div>
            <div class="type-sub">${escapeHtml(companyLine)}</div>
            ${reasonBlocks.join('')}
          </td>
          <td class="doc">${escapeHtml(row.docNumber)}</td>
          <td class="period">${period}</td>
          <td class="amount">${formatMoney(row.totalPrice)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="car-section">
        <div class="car-header">${escapeHtml(group.carLabel)}</div>
        <table class="policies-table">
          <thead>
            <tr>
              <th>التغطية / الحالة</th>
              <th>رقم المعاملة</th>
              <th>فترة التأمين</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  }).join('');

  // ── Ledger ──────────────────────────────────────────────────
  // Running balance: positive = customer owes us, negative = we owe
  // customer. Starts at 0 because the kashf is scoped to ONE year —
  // mixing in prior years' carry-overs would make the printed
  // running balance disagree with what the receipts page shows.
  let running = 0;
  const ledgerRowsHtml = ledger.map((r) => {
    const num = formatVoucherNumber(r.receipt_type, r.voucher_number, r.receipt_number, r.receipt_date);
    let typeLabel = RECEIPT_TYPE_LABELS[r.receipt_type] || r.receipt_type;
    if (r.receipt_type === 'credit_note' && Number(r.amount) < 0) {
      typeLabel = 'إشعار مدين';
    }
    const methodLabel = PAYMENT_TYPE_LABELS[r.payment_method] || r.payment_method || '';
    const amt = Math.abs(Number(r.amount || 0));
    const isDebit = isDebitForCustomer(r.receipt_type);
    const debitCell = isDebit ? formatMoney(amt) : '';
    const creditCell = !isDebit ? formatMoney(amt) : '';
    running += isDebit ? -amt : amt;
    const balanceCell = running === 0
      ? '0'
      : running > 0
        ? formatMoney(running)
        : `(${formatMoney(running)})`;

    // Detail lines — cheque bank+branch+maturity, refund/transfer
    // adjustments, plus the cancellation reason. Each is added only
    // when populated so the cell stays compact for ordinary rows.
    const detailLines: string[] = [];
    if (r.payment_method === 'cheque') {
      const meta = r.payment_id ? chequeMeta.get(r.payment_id) : null;
      const chequeNumStr = r.cheque_number ? `شيك #${escapeHtml(r.cheque_number)}` : '';
      const bankLabel = getBankLabel(meta?.bank_code);
      const branchLabel = meta?.branch_code ? `فرع ${escapeHtml(meta.branch_code)}` : '';
      const dueDate = meta?.cheque_date ? `استحقاق: ${formatDate(meta.cheque_date)}` : '';
      const chequeLine = [chequeNumStr, bankLabel, branchLabel, dueDate].filter(Boolean).join(' · ');
      if (chequeLine) detailLines.push(chequeLine);
    } else if (r.payment_method === 'visa' || r.payment_method === 'credit_card' || r.payment_method === 'visa_external') {
      if (r.card_last_four) detailLines.push(`بطاقة تنتهي بـ ${escapeHtml(r.card_last_four)}`);
    }
    if (r.car_number) detailLines.push(`سيارة: ${escapeHtml(r.car_number)}`);
    if (r.cancellation_reason) {
      detailLines.push(`<strong>سبب الإلغاء:</strong> ${escapeHtml(r.cancellation_reason)}`);
    }
    if (r.notes) {
      detailLines.push(escapeHtml(r.notes));
    }

    const description = `
      <div class="ledger-type"><strong>${escapeHtml(typeLabel)}</strong>${methodLabel ? ` · ${escapeHtml(methodLabel)}` : ''}</div>
      ${detailLines.length ? `<div class="ledger-detail">${detailLines.join('<br>')}</div>` : ''}
    `;

    return `
      <tr>
        <td class="vnum">${escapeHtml(num)}</td>
        <td class="date">${formatDate(r.receipt_date)}</td>
        <td class="ledger-cell">${description}</td>
        <td class="amount debit">${debitCell}</td>
        <td class="amount credit">${creditCell}</td>
        <td class="amount balance">${balanceCell}</td>
      </tr>
    `;
  }).join('');

  const emptyLedgerHtml = ledger.length === 0
    ? `<tr><td colspan="6" class="ledger-empty">لا توجد حركات مالية لهذه السنة</td></tr>`
    : '';

  // ── Totals + overall note ───────────────────────────────────
  const totalsHtml = `
    <div class="totals">
      <div class="totals-box">
        <div class="totals-row">
          <span class="totals-label">إجمالي معاملات ${year}</span>
          <span class="totals-value">${formatMoney(totalYearAmount)}</span>
        </div>
        <div class="totals-row">
          <span class="totals-label">إجمالي المدفوع لسنة ${year}</span>
          <span class="totals-value paid">${formatMoney(totalYearPaid)}</span>
        </div>
        <div class="totals-row totals-final">
          <span class="totals-label">المتبقي لسنة ${year}</span>
          <span class="totals-value ${totalYearRemaining === 0 ? 'cleared' : 'owed'}">${totalYearRemaining === 0 ? 'تم التسديد بالكامل' : formatMoney(totalYearRemaining)}</span>
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
    .ledger-table .ledger-type { font-size: 12px; font-weight: 700; }
    .ledger-table .ledger-detail {
      font-size: 10.5px; color: #555; margin-top: 3px;
      font-weight: 500; line-height: 1.5;
    }
    .ledger-table .ledger-empty {
      text-align: center; padding: 24px 12px;
      color: #6b7280; font-style: italic;
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
    .totals-row.totals-final .totals-value { font-size: 15px; }
    .totals-value.cleared { color: #86efac; }
    .totals-value.owed { color: #fca5a5; }

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

    <div class="section-title" style="border:1px solid #1a1a1a;border-bottom:none;margin-bottom:0">المعاملات والسيارات لسنة ${year}</div>
    ${policies.length === 0
      ? `<div style="border:1px solid #1a1a1a;border-top:none;padding:24px;text-align:center;color:#6b7280;font-style:italic;margin-bottom:22px">لا توجد معاملات بدأت في هذه السنة</div>`
      : `<div style="border:1px solid #1a1a1a;border-top:none;padding:14px;margin-bottom:22px">${carsHtml}</div>`}

    <div class="ledger">
      <div class="section-title">سجل الدفعات والسندات (${year})</div>
      <table class="ledger-table">
        <thead>
          <tr>
            <th style="width:90px">رقم السند</th>
            <th style="width:85px">التاريخ</th>
            <th>البيان</th>
            <th style="width:90px">مدين</th>
            <th style="width:90px">دائن</th>
            <th style="width:100px">الرصيد</th>
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

  <div class="actions no-print">
    <button onclick="window.print()">🖨️ طباعة</button>
    <button onclick="window.close()">✕ إغلاق</button>
  </div>
</body>
</html>`;
}

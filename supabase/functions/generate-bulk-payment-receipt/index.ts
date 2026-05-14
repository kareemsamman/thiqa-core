import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { getAgentBranding, resolveAgentId, DEFAULT_BRANDING, type AgentBranding } from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BulkReceiptRequest {
  payment_ids: string[];
  total_amount?: number; // optional verification
  // When true (used by the receipts page print button), expand the
  // scope from "just these payments" to "every non-إلزامي payment
  // this customer has ever made". The customer-level receipt is the
  // canonical "كشف قبض" the user wants — money the office actually
  // collected, not scoped to any one transaction. Defaults to false
  // so the SMS auto-receipt sent right after تسديد المبلغ keeps
  // showing only the just-collected session.
  customer_scope?: boolean;
}

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  visa: 'بطاقة ائتمان',
  visa_external: 'فيزا خارجي',
  transfer: 'تحويل بنكي',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  ELZAMI: 'إلزامي',
  THIRD_FULL: 'ثالث/شامل',
  ROAD_SERVICE: 'خدمات الطريق',
  ACCIDENT_FEE_EXEMPTION: 'إعفاء رسوم حادث',
  THIRD: 'ثالث',
  FULL: 'شامل',
  HEALTH: 'تأمين صحي',
  LIFE: 'تأمين حياة',
  PROPERTY: 'تأمين ممتلكات',
  TRAVEL: 'تأمين سفر',
  BUSINESS: 'تأمين أعمال',
  OTHER: 'أخرى',
};

// Minimal bank registry — mirrors src/lib/banks.ts so the printed
// receipt can resolve a stored bank_code to an Arabic name under
// each cheque row. Codes are zero-padded 2-digit strings. Unknown
// codes fall back to the raw code.
const BANK_LABELS: Record<string, string> = {
  "01": "ماكس إت فايننشلز",
  "02": "بنك بوعلي أغودات يسرائيل (فاغي)",
  "04": "بنك يهاف",
  "05": "يسراكارت",
  "06": "بنك أدانيم",
  "07": "كال - بطاقات ائتمان لإسرائيل",
  "08": "بنك هسفنوت",
  "09": "بنك البريد",
  "10": "بنك لئومي",
  "11": "بنك ديسكونت",
  "12": "بنك هبوعليم",
  "13": "بنك إيغود",
  "14": "بنك أوتسار هحيال",
  "17": "بنك مركنتيل ديسكونت",
  "18": "وان زيرو - البنك الرقمي الأول",
  "20": "بنك مزراحي طفحوت",
  "22": "سيتي بنك",
  "23": "HSBC",
  "24": "بنك هبوعليم (الأمريكي الإسرائيلي سابقاً)",
  "25": "BNP Paribas إسرائيل",
  "26": "يو بنك",
  "27": "باركليز بنك",
  "28": "هبوعليم (كونتيننتال سابقاً)",
  "30": "البنك للتجارة",
  "31": "البنك الدولي الأول لإسرائيل",
  "32": "بنك للتمويل والتجارة",
  "33": "بنك ديسكونت (مركنتيل سابقاً)",
  "34": "البنك العربي الإسرائيلي",
  "37": "بنك الأردن",
  "38": "البنك التجاري الفلسطيني",
  "39": "بنك الدولة الهندي (SBI)",
  "43": "البنك الأهلي الأردني",
  "46": "بنك مسد",
  "48": "بنك أوتسار هحيال (عوفيد لئومي سابقاً)",
  "49": "البنك العربي",
  "50": "مسب - مركز المقاصة البنكي",
  "52": "بنك بوعلي أغودات يسرائيل (فاغي)",
  "54": "بنك القدس (يروشلايم)",
  "59": "شبا - خدمات بنكية آلية",
  "60": "كاردكوم",
  "61": "ترانزيلا",
  "65": "حيسخ - صندوق توفير للتعليم",
  "66": "بنك القاهرة عمّان",
  "67": "بنك الأراضي العربية",
  "68": "بنك دكسيا / البنك البلدي",
  "71": "البنك التجاري الأردني",
  "73": "البنك الإسلامي العربي",
  "74": "البنك البريطاني للشرق الأوسط",
  "76": "بنك فلسطين للاستثمار",
  "77": "بنك لئومي للرهن العقاري",
  "82": "القدس للتنمية والاستثمار",
  "83": "بنك الاتحاد",
  "84": "بنك الإسكان",
  "89": "بنك فلسطين",
  "90": "بنك ديسكونت للرهن العقاري",
  "93": "بنك الأردن الكويت",
  "99": "بنك إسرائيل (البنك المركزي)",
};

const normalizeBankCode = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  if (/^\d$/.test(trimmed)) return trimmed.padStart(2, "0");
  return trimmed;
};

const getBankLabel = (code: string | null | undefined): string => {
  const norm = normalizeBankCode(code);
  if (!norm) return "";
  return BANK_LABELS[norm] || norm;
};

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit',
  });
}

interface PhoneLink {
  phone: string;
  href: string;
}

function escapeHtml(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paymentTypeLabel(p: { payment_type: string; locked?: boolean | null }): string {
  if (p.locked && p.payment_type === 'visa') return 'فيزا خارجي';
  return PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type;
}

function buildBulkReceiptHtml(
  payments: any[],
  totalAmount: number,
  client: any,
  car: any,
  _policyTypes: string[],
  _paymentDate: string,
  _paymentType: string,
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string },
  branding: AgentBranding = DEFAULT_BRANDING,
  // When true the receipt is a customer-level كشف قبض (every non-إلزامي
  // payment the customer ever made) and the "هذه السندات تخص المعاملة"
  // note is hidden — the receipt isn't scoped to a single transaction
  // anymore. Defaults to false for the SMS auto-receipt that still
  // wants the per-session framing.
  isCustomerLevel: boolean = false,
): string {
  const today = new Date();
  // Pick the package's representative document_number the same way the
  // card / payments log / printed invoice do: THIRD_FULL > ELZAMI >
  // addons, smallest doc number breaks ties. Without this the bulk
  // receipt header landed on whichever policy the payment rows were
  // ordered by, which disagreed with the invoice for the same معاملة.
  const documentPriority: Record<string, number> = { THIRD_FULL: 0, ELZAMI: 1 };
  const stampedForDoc = payments
    .map((p: any) => p.policy)
    .filter((pol: any) =>
      pol && typeof pol.document_number === 'string' && pol.document_number.trim().length > 0,
    )
    .map((pol: any) => ({
      doc: String(pol.document_number).trim(),
      rank: documentPriority[pol.policy_type_parent ?? ''] ?? 99,
    }))
    .sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.doc.localeCompare(b.doc, 'en', { numeric: true }));
  const primaryDocumentNumber = stampedForDoc[0]?.doc || '—';

  // Sum office_commission once per unique policy. Multiple payment rows
  // may reference the same policy — we don't want to count its
  // commission N times. Policies with a null / zero commission simply
  // don't contribute; the whole row is suppressed when the total is 0.
  const uniquePolicyCommissions = new Map<string, number>();
  for (const p of payments) {
    const policy = (p as any).policy;
    const pid = policy?.id;
    const commission = Number(policy?.office_commission) || 0;
    if (pid && commission > 0 && !uniquePolicyCommissions.has(pid)) {
      uniquePolicyCommissions.set(pid, commission);
    }
  }
  const totalCommission = Array.from(uniquePolicyCommissions.values()).reduce(
    (s, c) => s + c,
    0,
  );

  // Contact footer lines — phones / whatsapp / email / address pulled from
  // the agent's sms_settings row, same as the package invoice footer.
  const phoneLinksHtml = (companySettings.company_phone_links || []).map(
    (link: PhoneLink) => `<a href="${link.href}">${link.phone}</a>`
  ).join(' / ');
  const contactLines: string[] = [];
  if (phoneLinksHtml) contactLines.push(`هاتف: ${phoneLinksHtml}`);
  if (companySettings.company_email) {
    contactLines.push(`بريد: <a href="mailto:${companySettings.company_email}">${companySettings.company_email}</a>`);
  }
  if (companySettings.company_location) {
    contactLines.push(`عنوان: ${escapeHtml(companySettings.company_location)}`);
  }
  const contactFooterHtml = contactLines.length > 0
    ? `<div class="contact">${contactLines.join(' · ')}</div>`
    : '';

  // Rows for the receipts table. Refused rows are tagged and styled
  // with a strikethrough; their amounts are excluded from the total
  // so they don't count toward what the client actually paid. A
  // dedicated ملاحظات column surfaces per-payment notes at the end —
  // only rendered when at least one payment actually has notes, so
  // the table stays compact otherwise.
  const anyNotes = payments.some(
    (p: any) => typeof p.notes === 'string' && p.notes.trim().length > 0,
  );
  // Display dedupe: legacy data has one collection event spread
  // across N rows with N different R-numbers (the BEFORE-INSERT
  // trigger allocated per row). Per the user's rule "one سند قبض =
  // one number, no matter how many rows", every row of the same
  // session/batch should show the SAME R-number on the printed
  // copy. We pick the smallest one as the canonical — same fallback
  // chain as groupedPayments (`payment_session_id` → `batch_id` →
  // `payment.id`).  New data from the app-side pre-allocate path
  // already shares one R-number across the submit, so this map is a
  // no-op there.
  const receiptGroupKey = (p: any): string =>
    p.payment_session_id || p.batch_id || p.id;
  const canonicalReceiptByGroup = new Map<string, string>();
  for (const p of payments as any[]) {
    if (!p.receipt_number) continue;
    const key = receiptGroupKey(p);
    const existing = canonicalReceiptByGroup.get(key);
    if (!existing || String(p.receipt_number) < existing) {
      canonicalReceiptByGroup.set(key, String(p.receipt_number));
    }
  }
  // When the print is scoped to a single سند قبض (the common case
  // after Receipts.tsx stopped opting into customer_scope), every row
  // shares one R-number. That number lives prominently in the header
  // meta block, so repeating it in a "رقم سند القبض" body column on
  // every line is just noise. We hide the column when there's one
  // unique canonical R-number across the payments, and show it when
  // multiple sessions are bundled (the kept-for-now customer-scope
  // path used by callers that still pass isCustomerLevel=true).
  const uniqueCanonicals = new Set<string>(canonicalReceiptByGroup.values());
  const showReceiptNumberColumn = uniqueCanonicals.size > 1;
  // Session R-number for the header row — only meaningful when the
  // print is one سند. Falls back to the only entry in the map.
  const headerReceiptNumber = uniqueCanonicals.size === 1
    ? Array.from(uniqueCanonicals)[0]
    : null;

  const receiptRows = payments.map((p: any) => {
    const num = canonicalReceiptByGroup.get(receiptGroupKey(p)) || p.receipt_number || '—';
    const typeLbl = paymentTypeLabel(p);
    const extra = p.cheque_number ? ` · ${escapeHtml(String(p.cheque_number))}` : '';
    // A سند قبض is a frozen historical document — like a paper
    // receipt that was already handed to the customer, it can't
    // retroactively show "cancelled" / "partially cancelled" /
    // strikethrough / red styling after the fact. Any subsequent
    // cancellation lives in a separate سند إلغاء document, not on
    // the original receipt. So we render refused rows identically
    // to active ones here.
    const amount = Number(p.amount || 0).toLocaleString('en-US');
    const amountCell = `₪${amount}`;

    // Per-row date cell. Cheques carry two distinct dates:
    //   • تاريخ الاستحقاق (when the bank will honour it) — stored on
    //     cheque_due_date now; legacy rows used cheque_date.
    //   • تاريخ الإصدار (when the cheque was written) — cheque_issue_date.
    // Both are rendered stacked so the customer can verify maturity
    // and issue independently. Cash / transfer / card collapse to a
    // single "تاريخ القبض" row — those payments are on-the-spot, so
    // there's only one relevant date.
    const dateCell = (() => {
      if (p.payment_type !== 'cheque') {
        return `
          <div class="date-label">تاريخ القبض</div>
          <div class="date-value">${formatDate(p.payment_date)}</div>
        `;
      }
      const dueDate = p.cheque_due_date || p.cheque_date || p.payment_date;
      const issueDate = p.cheque_issue_date || null;
      return `
        <div class="date-label">تاريخ الاستحقاق</div>
        <div class="date-value">${dueDate ? formatDate(dueDate) : '—'}</div>
        <div class="date-label" style="margin-top:6px">تاريخ الإصدار</div>
        <div class="date-value">${issueDate ? formatDate(issueDate) : '—'}</div>
      `;
    })();
    const notesCell = anyNotes
      ? `<td class="notes">${escapeHtml(p.notes || '').replace(/\n/g, '<br>') || '—'}</td>`
      : '';

    // Cheque bank/branch detail line — rendered under the cheque
    // number when either field is populated. Muted grey so it reads
    // as supporting info, not a new row.
    const bankLabel = getBankLabel(p.bank_code);
    const branchLabel = p.branch_code
      ? `فرع ${escapeHtml(String(p.branch_code))}`
      : '';
    const bankLine = (bankLabel || branchLabel)
      ? `<div class="cheque-bank-line">${[escapeHtml(bankLabel), branchLabel].filter(Boolean).join(' · ')}</div>`
      : '';

    return `
      <tr>
        ${showReceiptNumberColumn ? `<td class="num">${escapeHtml(num)}</td>` : ''}
        <td>
          <div>${escapeHtml(typeLbl)}${extra}</div>
          ${bankLine}
        </td>
        <td class="date">${dateCell}</td>
        <td class="amount">${amountCell}</td>
        ${notesCell}
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>سندات قبض - ${escapeHtml(client?.full_name || 'عميل')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    /* margin:0 on @page removes Chrome's default print header/footer
       (date, title, URL, page number) since they're drawn in the page
       margin area and have no room to render. */
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
    .invoice {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #1a1a1a;
      padding: 32px 34px;
    }

    .invoice-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid #1a1a1a;
      margin-bottom: 24px;
    }
    .brand { max-width: 340px; }
    .brand .logo { max-height: 70px; max-width: 180px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; color: #1a1a1a; }
    .brand .tax {
      font-size: 12px; color: #1a1a1a; margin-top: 2px;
      direction: ltr; text-align: right;
      font-variant-numeric: tabular-nums; font-weight: 500;
    }
    .brand .address { font-size: 12px; color: #1a1a1a; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px; font-weight: 800; letter-spacing: 0.5px;
      color: #1a1a1a; line-height: 1; margin-bottom: 4px;
    }
    .invoice-meta .subtitle {
      font-size: 12px; color: #1a1a1a; margin-bottom: 14px; opacity: 0.7;
    }
    .meta-rows { width: 100%; border: 1px solid #1a1a1a; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid #1a1a1a; }
    .meta-rows .label {
      flex: 0 0 110px; padding: 7px 12px;
      background: #f4f4f5; font-weight: 700; color: #1a1a1a;
      font-size: 11.5px; text-align: right;
      border-left: 1px solid #1a1a1a; letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1; padding: 7px 12px;
      text-align: left; direction: ltr;
      font-weight: 700; color: #1a1a1a;
      font-variant-numeric: tabular-nums;
    }

    .customer { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 1.5px; text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell:not(:nth-child(3n+1)) { border-right: 1px solid #1a1a1a; }
    .customer-grid .cell:nth-child(n+4) { border-top: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px; font-weight: 700; color: #1a1a1a;
      letter-spacing: 0.3px; margin-bottom: 3px; opacity: 0.75;
    }
    .customer-grid .value { font-size: 13px; font-weight: 600; color: #1a1a1a; }

    /* Receipts table */
    .receipts-section { margin-bottom: 22px; }
    .receipts {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      border: 1px solid #1a1a1a;
    }
    .receipts thead th {
      background: #f4f4f5;
      color: #1a1a1a;
      font-size: 11px; font-weight: 700;
      letter-spacing: 1px; text-transform: uppercase;
      padding: 9px 12px; text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .receipts thead th:last-child { border-left: none; }
    .receipts tbody td {
      padding: 10px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; font-weight: 500;
      vertical-align: middle;
    }
    /* Small muted-grey line under a cheque row showing the bank name
       and branch — only rendered when either field is populated. */
    .receipts tbody .cheque-bank-line {
      font-size: 10.5px;
      font-weight: 500;
      color: #6b7280;
      margin-top: 2px;
    }
    .receipts tbody td:last-child { border-left: none; }
    .receipts tbody tr:first-child td { border-top: none; }
    .receipts tbody td.num,
    .receipts tbody td.amount {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700;
    }
    /* Date cell carries a small caption ("تاريخ الاستحقاق" for cheques,
       "تاريخ القبض" otherwise) above the actual date so each row
       self-labels even though the column header is generic. */
    .receipts tbody td.date {
      text-align: right;
      font-weight: 500;
    }
    .receipts tbody td.date .date-label {
      font-size: 10px;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 2px;
      letter-spacing: 0.2px;
    }
    .receipts tbody td.date .date-value {
      direction: ltr;
      text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      color: #1a1a1a;
    }
    .receipts tbody td.notes {
      text-align: right; font-weight: 500; color: #1a1a1a;
      max-width: 200px; white-space: normal; word-break: break-word;
    }

    .total-row {
      display: flex; justify-content: flex-end;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .total-row .box {
      border: 1px solid #1a1a1a;
      display: flex; align-items: stretch;
    }
    .total-row .box .label {
      padding: 14px 20px;
      background: #1a1a1a; color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .total-row .box .val {
      padding: 14px 28px;
      font-size: 28px; font-weight: 800;
      color: #1a1a1a;
      direction: ltr;
      font-variant-numeric: tabular-nums;
    }
    /* Commission box — inverted palette (amber label on white) so it
       reads as supporting info and doesn't compete with the main total. */
    .total-row .box.commission-box {
      border-color: #b45309;
    }
    .total-row .box.commission-box .label {
      background: #fef3c7;
      color: #78350f;
    }
    .total-row .box.commission-box .val {
      font-size: 22px;
      color: #78350f;
    }

    .policy-note {
      border: 1px solid #1a1a1a;
      padding: 12px 16px; margin-bottom: 24px;
      font-size: 12px; color: #1a1a1a; background: #f9fafb;
    }
    .policy-note strong {
      font-weight: 700; font-variant-numeric: tabular-nums;
      direction: ltr; display: inline-block;
    }

    .footer {
      padding-top: 16px; border-top: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; text-align: center;
    }
    .footer .thanks { font-weight: 700; margin-bottom: 6px; }
    .footer .contact { line-height: 1.8; }
    .footer .contact a { color: #1a1a1a; text-decoration: none; }
    .footer .issued { margin-top: 10px; opacity: 0.7; }

    .actions {
      margin-top: 18px;
      display: flex; gap: 10px; justify-content: center;
    }
    .actions button {
      padding: 10px 22px;
      background: #1a1a1a; color: #ffffff;
      border: none; font-family: inherit;
      font-size: 13px; font-weight: 700;
      cursor: pointer; letter-spacing: 0.5px;
    }
    .actions button:hover { opacity: 0.85; }

    @media (max-width: 640px) {
      body { padding: 14px 8px; font-size: 12px; }
      .invoice { padding: 22px 18px; }
      /* Stack + center header on mobile with a bigger logo cap. */
      .invoice-top {
        flex-direction: column;
        align-items: center;
        gap: 16px;
        text-align: center;
      }
      .brand {
        max-width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .brand .logo {
        max-height: 110px;
        max-width: 260px;
        margin-left: auto;
        margin-right: auto;
      }
      .brand .address { text-align: center; }
      .invoice-meta {
        text-align: center;
        min-width: 0;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
      }
      .invoice-meta .doc-title { font-size: 36px; }
      .meta-rows { width: 100%; max-width: 320px; }
      .customer-grid { grid-template-columns: 1fr; }
      .customer-grid .cell:not(:nth-child(3n+1)) { border-right: none; }
      .customer-grid .cell:nth-child(n+2) { border-top: 1px solid #1a1a1a; }
      .total-row .box .val { font-size: 22px; padding: 12px 18px; }
    }
  </style>
</head>
<body>
  <div class="invoice">
    <!-- Header -->
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${(branding as any).taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml((branding as any).taxNumber)}</div>` : ''}
        ${(branding as any).invoiceAddress ? `<div class="address">${escapeHtml((branding as any).invoiceAddress)}</div>`
          : (companySettings.company_location ? `<div class="address">${escapeHtml(companySettings.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">${headerReceiptNumber ? 'سند قبض' : 'سندات قبض'}</div>
        ${headerReceiptNumber
          ? ''
          : `<div class="subtitle">${payments.length} ${payments.length === 1 ? 'سند قبض' : 'سندات قبض'}</div>`}
        <div class="meta-rows">
          ${headerReceiptNumber
            ? `<div class="row">
                 <div class="label">رقم السند</div>
                 <div class="val">${escapeHtml(headerReceiptNumber)}</div>
               </div>`
            : ''}
          <div class="row">
            <div class="label">التاريخ</div>
            <div class="val">${formatDate(today.toISOString())}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customer info -->
    <div class="customer">
      <div class="section-title">معلومات العميل</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">الاسم</div>
          <div class="value">${escapeHtml(client?.full_name || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value">${escapeHtml(client?.id_number || '-')}</div>
        </div>
        <div class="cell">
          <div class="label">${[client?.phone_number, client?.phone_number_2].filter(Boolean).length > 1 ? 'أرقام الهاتف' : 'رقم الهاتف'}</div>
          <div class="value">${escapeHtml([client?.phone_number, client?.phone_number_2].filter(Boolean).join(' / ') || '-')}</div>
        </div>
      </div>
    </div>

    <!-- Receipts table -->
    <div class="receipts-section">
      <div class="section-title">الدفعات المستلمة</div>
      <table class="receipts">
        <thead>
          <tr>
            ${showReceiptNumberColumn ? '<th style="width: 110px;">رقم سند القبض</th>' : ''}
            <th style="width: 150px;">طريقة الدفع</th>
            <th style="width: 130px;">التاريخ</th>
            <th style="width: 110px;">المبلغ</th>
            ${anyNotes ? '<th>ملاحظات</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${receiptRows}
        </tbody>
      </table>
    </div>

    <!-- Totals — optional commission line on top, then the grand total -->
    <div class="total-row">
      ${totalCommission > 0 ? `
      <div class="box commission-box">
        <div class="label">عمولة المكتب</div>
        <div class="val">₪${totalCommission.toLocaleString('en-US')}</div>
      </div>
      ` : ''}
      <div class="box">
        <div class="label">المجموع</div>
        <div class="val">₪${totalAmount.toLocaleString('en-US')}</div>
      </div>
    </div>

    <!-- The legacy "هذه السندات تخص المعاملة رقم N/2026" note was
         removed per the user's rule: a printed سند قبض carries one
         R-number at the top and nothing else; there's no separate
         "transaction number" concept on the printed copy. -->


    <!-- Footer -->
    <div class="footer">
      <div class="thanks">شكراً لثقتكم</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
      <button type="button" onclick="shareReceipts()">مشاركة</button>
    </div>
  </div>

  <script>
    function shareReceipts() {
      var url = window.location.href;
      if (navigator.share) {
        navigator.share({ title: 'سندات قبض', url: url }).catch(function(){});
      } else {
        window.open('https://wa.me/?text=' + encodeURIComponent('سندات قبض: ' + url), '_blank');
      }
    }
  </script>
</body>
</html>
  `;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve agent branding
    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    const { payment_ids, total_amount, customer_scope }: BulkReceiptRequest = await req.json();

    if (!payment_ids || payment_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: "payment_ids is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[generate-bulk-payment-receipt] Processing ${payment_ids.length} payments (customer_scope=${!!customer_scope})`);

    // Fetch company settings for contact info
    const { data: smsSettings } = await supabase
      .from("sms_settings")
      .select("company_email, company_phone_links, company_location")
      .limit(1)
      .maybeSingle();

    const companySettings = {
      company_email: smsSettings?.company_email || '',
      company_phone_links: (smsSettings?.company_phone_links as any[]) || [],
      company_location: smsSettings?.company_location || '',
    };

    // Build the SELECT once — both the seed query (just the input
    // payment_ids) and the customer-scope expansion below need the
    // same shape including the new batch_id + insurance_price fields
    // we use for collapse and ELZAMI filtering.
    const selectClause = `
        id,
        amount,
        payment_type,
        payment_date,
        cheque_number,
        cheque_date,
        cheque_due_date,
        cheque_issue_date,
        bank_code,
        branch_code,
        card_last_four,
        cheque_status,
        cancellation_reason,
        locked,
        refused,
        printed_at,
        notes,
        receipt_number,
        batch_id,
        payment_session_id,
        policy:policies(
          id,
          policy_type_parent,
          policy_type_child,
          document_number,
          insurance_price,
          office_commission,
          client_id,
          client:clients(id, full_name, id_number, phone_number, phone_number_2),
          car:cars(car_number, manufacturer_name, model, year)
        )
      `;

    // Fetch the seed set so we can derive the customer (and skip the
    // customer-scope expansion when the caller didn't ask for it).
    const { data: seedPayments, error: seedError } = await supabase
      .from("policy_payments")
      .select(selectClause)
      .in("id", payment_ids)
      .order('payment_date', { ascending: true });

    if (seedError || !seedPayments || seedPayments.length === 0) {
      console.error("[generate-bulk-payment-receipt] Payments not found:", seedError);
      return new Response(
        JSON.stringify({ error: "Payments not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // When customer_scope=true the receipts page wants every non-إلزامي
    // payment this customer ever made — not just the rows of whatever
    // transaction the user clicked print on. Walk policy → client_id,
    // refetch every policy_payment under that client_id.
    let payments = seedPayments;
    if (customer_scope) {
      const seedPolicy = (seedPayments[0] as any).policy;
      const seedPolicyResolved = Array.isArray(seedPolicy) ? seedPolicy[0] : seedPolicy;
      const clientId = seedPolicyResolved?.client_id;
      if (clientId) {
        const { data: clientPolicies } = await supabase
          .from('policies')
          .select('id')
          .eq('client_id', clientId)
          .is('deleted_at', null);
        const clientPolicyIds = (clientPolicies ?? []).map((p: any) => p.id);
        if (clientPolicyIds.length > 0) {
          const { data: allCustomerPayments, error: expandErr } = await supabase
            .from("policy_payments")
            .select(selectClause)
            .in("policy_id", clientPolicyIds)
            .order('payment_date', { ascending: true });
          if (!expandErr && allCustomerPayments && allCustomerPayments.length > 0) {
            payments = allCustomerPayments;
          }
        }
      }
    }

    // Drop payments the office never actually collected:
    //  1. payment_type='visa_external' — the customer paid the
    //     insurer directly via their own card. The row exists for
    //     accounting context but the money never passed through the
    //     office, so it has no business on a سند قبض.
    //  2. ELZAMI premium recorded as cash/cheque/transfer with the
    //     system-generated `locked=true` flag (legacy WP imports +
    //     pre-visa_external auto rows). The `locked` gate is what
    //     keeps a real cash إلزامي payment — collected by the office
    //     via the "دفع" button — visible on the printed receipt; only
    //     the system-stamped passthrough records are filtered out.
    //
    // Refused rows are NOT filtered. Per the user's accounting rule
    // (feedback_payment_receipt_immutable.md), a سند قبض is a frozen
    // historical document: cancelling a cheque later doesn't erase
    // it from the original receipt. The matching سند إلغاء carries
    // the reversal separately.
    payments = payments.filter((p: any) => {
      if (p.payment_type === 'visa_external') return false;
      if (p.locked !== true) return true;
      const pol = Array.isArray(p.policy) ? p.policy[0] : p.policy;
      if (!pol || pol.policy_type_parent !== 'ELZAMI') return true;
      const price = Number(pol.insurance_price ?? 0);
      if (price <= 0) return true;
      return Math.abs(Number(p.amount ?? 0) - price) >= 0.005;
    });

    // Collapse multi-split rows: when a single physical cheque was
    // split across N policies (handleSubmit assigns the same batch_id
    // to all rows), we want ONE row on the printed receipt at the
    // cheque's true face value (= sum of every sibling's amount), not
    // N rows showing the per-policy slices. Per the user's rule,
    // cheques MUST NEVER appear split on the printed سند.
    //
    // Grouping signal, in priority order:
    //   1. batch_id — the canonical key DebtPaymentModal stamps when
    //      splits.length > 1. New data with proper splits hits this.
    //   2. Cheque physical identity — same cheque_number + bank +
    //      branch + maturity + issue within the same session HAS to be
    //      the same physical cheque. This is the safety net for any
    //      path that didn't stamp batch_id (legacy data, pre-allocate
    //      RPC fallback, edits, or any other code path that touches
    //      policy_payments without going through DebtPaymentModal).
    //   3. Standalone — non-cheque rows without batch_id render as
    //      one row each. We deliberately do NOT merge cash / transfer
    //      / card by session, because a user can legitimately enter
    //      two cash lines in one submit.
    const physicalInstrumentKey = (p: any): string => {
      if (p.batch_id) return `b:${p.batch_id}`;
      if (p.payment_type === 'cheque' && p.cheque_number) {
        const session = p.payment_session_id || 'no-session';
        const due = p.cheque_due_date || p.cheque_date || '';
        const issue = p.cheque_issue_date || '';
        return `c:${session}:${p.cheque_number}:${p.bank_code || ''}:${p.branch_code || ''}:${due}:${issue}`;
      }
      return `id:${p.id}`;
    };
    const collapsePhysicalInstrument = (rows: any[]): any[] => {
      const out: any[] = [];
      const idxByKey = new Map<string, number>();
      for (const p of rows) {
        const key = physicalInstrumentKey(p);
        const amt = Number(p.amount ?? 0);
        const existing = idxByKey.get(key);
        if (existing === undefined) {
          idxByKey.set(key, out.length);
          out.push({ ...p, amount: amt });
        } else {
          out[existing].amount += amt;
        }
      }
      return out;
    };
    const beforeCount = payments.length;
    payments = collapsePhysicalInstrument(payments);
    if (beforeCount !== payments.length) {
      console.log(`[generate-bulk-payment-receipt] Collapsed ${beforeCount} → ${payments.length} rows (merged physical instruments)`);
    }

    if (payments.length === 0) {
      // The seed survived the SELECT but everything got filtered as
      // إلزامي passthrough. Return a friendly error so the caller can
      // surface it to the user instead of silently producing an empty
      // receipt.
      return new Response(
        JSON.stringify({ error: "لا توجد دفعات قابلة للطباعة (كل الدفعات إلزامي مرور للشركة)" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Calculate total from payments — refused rows ARE included
    // because a سند قبض is a frozen historical document. It must
    // reflect the original collection event (the moment money
    // changed hands), not the current refused state. The matching
    // سند إلغاء carries the reversal separately.
    const calculatedTotal = payments.reduce((sum, p: any) => {
      return sum + Number(p.amount || 0);
    }, 0);
    // Ignore the caller's total_amount hint — after collapse + ELZAMI
    // filter the displayed rows can sum to a different number than
    // what the caller saw at submit time, and showing a footer total
    // that disagrees with the row sum would confuse the bookkeeper.
    // The hint is left in the request shape for backwards compat but
    // no longer used.
    const finalTotal = calculatedTotal;
    if (total_amount && Math.abs(total_amount - calculatedTotal) > 0.01) {
      console.log(`[generate-bulk-payment-receipt] total_amount hint (${total_amount}) differs from row sum (${calculatedTotal}); using row sum`);
    }

    // Get client and car info from first payment
    const firstPolicy = (payments[0] as any).policy;
    const client = firstPolicy?.client?.[0] || firstPolicy?.client || {};
    const car = firstPolicy?.car?.[0] || firstPolicy?.car || {};

    // Collect all policy types
    const policyTypes: string[] = [];
    for (const payment of payments) {
      const policy = (payment as any).policy;
      if (policy?.policy_type_parent) {
        // Use child type for THIRD_FULL
        if (policy.policy_type_parent === 'THIRD_FULL' && policy.policy_type_child) {
          policyTypes.push(policy.policy_type_child);
        } else {
          policyTypes.push(policy.policy_type_parent);
        }
      }
    }

    // Get payment date and type from first payment
    const paymentDate = payments[0].payment_date || new Date().toISOString();
    const paymentType = payments[0].payment_type || 'cash';

    console.log(`[generate-bulk-payment-receipt] Total: ${finalTotal}, Policy types: ${policyTypes.join(', ')}`);

    // Generate receipt HTML
    const receiptHtml = buildBulkReceiptHtml(
      payments,
      finalTotal,
      client,
      car,
      policyTypes,
      paymentDate,
      paymentType,
      companySettings,
      branding,
      !!customer_scope,
    );

    if (!bunnyApiKey || !bunnyStorageZone) {
      // Return HTML directly without storing
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Upload to Bunny CDN
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const clientNameSafe = client?.full_name?.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_') || 'customer';
    const storagePath = `receipts/${year}/${month}/bulk_receipt_${clientNameSafe}_${timestamp}_${randomId}.html`;

    const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    
    console.log(`[generate-bulk-payment-receipt] Uploading receipt to: ${bunnyUploadUrl}`);

    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: receiptHtml,
    });

    if (!uploadResponse.ok) {
      console.error('[generate-bulk-payment-receipt] Bunny upload failed');
      // Return HTML directly as fallback
      return new Response(receiptHtml, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }

    const receiptUrl = `${bunnyCdnUrl}/${storagePath}`;
    console.log(`[generate-bulk-payment-receipt] Receipt uploaded: ${receiptUrl}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        receipt_url: receiptUrl,
        total_amount: finalTotal,
        payment_count: payments.length
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("[generate-bulk-payment-receipt] Fatal error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

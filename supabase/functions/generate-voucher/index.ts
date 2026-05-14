// ─── generate-voucher ─────────────────────────────────────────
//
// Unified printable-voucher renderer. Takes ONE receipts.id and
// produces the right HTML for whichever voucher kind that row is
// (سند قبض / سند صرف / إشعار دائن / سند إلغاء). The legacy
// per-kind functions (generate-bulk-payment-receipt,
// generate-disbursement-voucher, generate-credit-note-voucher,
// generate-cancellation-voucher) still exist for backwards
// compatibility; new flows should target this one instead.
//
// Counterparty resolution branches on what the receipt row carries:
//   • client_id  → fetch from clients table (the original family)
//   • broker_id  → fetch from brokers table (new mirror, see
//     migration 20260514150000)
//   • fallback   → use receipts.client_name as display only
//
// Payment-line resolution does the same:
//   • payment_id            → policy_payments + session siblings
//   • client_settlement_id  → client_settlements + session siblings
//   • broker_settlement_id  → broker_settlements + time-window siblings
//   • fallback              → single line built from the receipts row
//
// Each receipt_type drives its own accent colour, title, date-label
// vocabulary, and CDN file-slug — so the four printable documents
// stay visually consistent across counterparty types while reading
// correctly for what they are.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  getAgentBranding,
  resolveAgentId,
  DEFAULT_BRANDING,
  type AgentBranding,
} from "../_shared/agent-branding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface VoucherRequest {
  voucher_receipt_id: string;
}

interface PhoneLink {
  phone: string;
  href: string;
}

type ReceiptType = 'payment' | 'disbursement' | 'credit_note' | 'cancellation';

interface TypeConfig {
  title: string;
  subtitle: string;
  accent: string;
  accentBg: string;
  voucherNumberLabel: string;
  totalLabel: string;
  detailsSectionTitle: string;
  defaultDateLabel: string;
  thanksLine: string;
  fileSlugPrefix: string;
}

// Per-kind copy + theming. The four entries here are the single
// source of truth for "what does THIS voucher look like" — change
// one number/string and every counterparty type that produces this
// kind picks it up. Accent colours follow the same family the
// receipts page uses for its row badges (emerald/rose/amber/red)
// so the user sees the same visual vocabulary table → printout.
const TYPE_CONFIGS: Record<ReceiptType, TypeConfig> = {
  payment: {
    title: 'سند قبض',
    subtitle: 'قبض مبلغ من الجهة',
    accent: '#15803d',
    accentBg: '#dcfce7',
    voucherNumberLabel: 'رقم سند القبض',
    totalLabel: 'المبلغ المقبوض',
    detailsSectionTitle: 'تفاصيل القبض',
    defaultDateLabel: 'تاريخ القبض',
    thanksLine: 'تم استلام المبلغ أعلاه بالكامل.',
    fileSlugPrefix: 'payment',
  },
  disbursement: {
    title: 'سند صرف',
    subtitle: 'صرف مبلغ للجهة',
    accent: '#1e3a5f',
    accentBg: '#eef4fb',
    voucherNumberLabel: 'رقم سند الصرف',
    totalLabel: 'المجموع المصروف',
    detailsSectionTitle: 'تفاصيل الصرف',
    defaultDateLabel: 'تاريخ الصرف',
    thanksLine: 'تم صرف المبلغ أعلاه للجهة بالكامل.',
    fileSlugPrefix: 'disbursement',
  },
  credit_note: {
    title: 'إشعار دائن',
    subtitle: 'إثبات رصيد دائن للجهة',
    accent: '#b45309',
    accentBg: '#fef3c7',
    voucherNumberLabel: 'رقم الإشعار',
    totalLabel: 'الرصيد الدائن',
    detailsSectionTitle: 'تفاصيل الإشعار',
    defaultDateLabel: 'تاريخ الإصدار',
    thanksLine: 'هذا الإشعار يثبت رصيداً دائناً لدى المكتب.',
    fileSlugPrefix: 'credit_note',
  },
  cancellation: {
    title: 'سند إلغاء',
    subtitle: 'إلغاء سند قبض سابق',
    accent: '#b91c1c',
    accentBg: '#fee2e2',
    voucherNumberLabel: 'رقم سند الإلغاء',
    totalLabel: 'المبلغ الملغى',
    detailsSectionTitle: 'تفاصيل الإلغاء',
    defaultDateLabel: 'تاريخ الإلغاء',
    thanksLine: 'تم إلغاء السند المذكور.',
    fileSlugPrefix: 'cancellation',
  },
};

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: 'نقدي',
  cheque: 'شيك',
  customer_cheque: 'شيك عميل',
  visa: 'بطاقة ائتمان',
  visa_external: 'فيزا خارجي',
  bank_transfer: 'تحويل بنكي',
  transfer: 'تحويل بنكي',
  multiple: 'متعدد',
};

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
  "26": "يو بنك",
  "31": "البنك الدولي الأول لإسرائيل",
  "34": "البنك العربي الإسرائيلي",
  "46": "بنك مسد",
  "54": "بنك القدس (يروشلايم)",
  "89": "بنك فلسطين",
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

function escapeHtml(str: string | null | undefined): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

interface VoucherLine {
  payment_type: string;
  cheque_number: string | null;
  cheque_due_date: string | null;
  cheque_issue_date: string | null;
  payment_date: string | null;
  bank_code: string | null;
  branch_code: string | null;
  bank_reference: string | null;
  notes: string | null;
  amount: number;
}

interface Counterparty {
  /** Drives the section title — 'معلومات العميل' vs 'معلومات الوسيط'
   *  vs 'معلومات الجهة' — and the per-cell labels. */
  kind: 'client' | 'broker' | 'manual';
  full_name: string;
  id_number: string | null;
  phone_number: string | null;
  phone_number_2: string | null;
}

interface VoucherMeta {
  voucher_number: string;
  settlement_date: string;
  total_amount: number;
  notes: string | null;
}

function buildHtml(
  cfg: TypeConfig,
  voucher: VoucherMeta,
  lines: VoucherLine[],
  source: { policy_document_number: string | null; policy_number: string | null } | null,
  counterparty: Counterparty,
  companySettings: { company_email?: string; company_phone_links?: PhoneLink[]; company_location?: string },
  branding: AgentBranding = DEFAULT_BRANDING,
): string {
  const today = new Date();
  const phoneLinksHtml = (companySettings.company_phone_links || []).map(
    (link: PhoneLink) => `<a href="${link.href}">${link.phone}</a>`,
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

  const phoneDisplay = [counterparty.phone_number, counterparty.phone_number_2]
    .filter(Boolean).join(' / ') || '-';

  const counterpartySectionTitle =
    counterparty.kind === 'broker' ? 'معلومات الوسيط'
      : counterparty.kind === 'client' ? 'معلومات العميل'
        : 'معلومات الجهة';
  const counterpartyNameLabel =
    counterparty.kind === 'broker' ? 'اسم الوسيط' : 'الاسم';

  const accent = cfg.accent;
  const accentBg = cfg.accentBg;

  const anyNotes = lines.some((l) => typeof l.notes === 'string' && l.notes.trim().length > 0);

  // Date-cell renderer. Cheques carry both maturity AND issue dates;
  // cash / transfer / card collapse to one date with a type-appropriate
  // label (defaultDateLabel from typeConfig).
  const renderDateCell = (line: VoucherLine): string => {
    if (line.payment_type === 'cheque') {
      const issue = line.cheque_issue_date ? formatDate(line.cheque_issue_date) : '—';
      const due = line.cheque_due_date ? formatDate(line.cheque_due_date) : '—';
      return `
        <div>
          <div class="date-label">تاريخ الاستحقاق</div>
          <div class="date-value">${due}</div>
        </div>
        <div style="margin-top: 5px;">
          <div class="date-label">تاريخ الإصدار</div>
          <div class="date-value">${issue}</div>
        </div>`;
    }
    if (line.payment_type === 'customer_cheque') {
      const due = line.cheque_due_date ? formatDate(line.cheque_due_date) : '—';
      return `
        <div class="date-label">تاريخ الاستحقاق</div>
        <div class="date-value">${due}</div>`;
    }
    const dateValue = line.payment_date || '';
    const dateLabel = line.payment_type === 'bank_transfer' || line.payment_type === 'transfer'
      ? 'تاريخ التحويل'
      : cfg.defaultDateLabel;
    return `
      <div class="date-label">${dateLabel}</div>
      <div class="date-value">${dateValue ? formatDate(dateValue) : '—'}</div>`;
  };

  const linesHtml = lines.length
    ? lines.map((line) => {
        const methodLabel = PAYMENT_TYPE_LABELS[line.payment_type] || line.payment_type;
        const chequeExtra = line.cheque_number ? ` · ${escapeHtml(String(line.cheque_number))}` : '';
        const amount = Number(line.amount || 0).toLocaleString('en-US');
        const bankLabel = getBankLabel(line.bank_code);
        const branchLabel = line.branch_code ? `فرع ${escapeHtml(String(line.branch_code))}` : '';
        const bankRefLabel = line.bank_reference
          ? `مرجع: ${escapeHtml(String(line.bank_reference))}`
          : '';
        const supplementBits = [
          bankLabel ? escapeHtml(bankLabel) : '',
          branchLabel,
          bankRefLabel,
        ].filter(Boolean);
        const bankLine = supplementBits.length
          ? `<div class="cheque-bank-line">${supplementBits.join(' · ')}</div>`
          : '';
        const notesCell = anyNotes
          ? `<td class="notes">${escapeHtml(line.notes || '').replace(/\n/g, '<br>') || '—'}</td>`
          : '';
        return `
          <tr>
            <td>
              <div>${escapeHtml(methodLabel)}${chequeExtra}</div>
              ${bankLine}
            </td>
            <td class="date">${renderDateCell(line)}</td>
            <td class="line-amount">₪${amount}</td>
            ${notesCell}
          </tr>`;
      }).join('')
    : '';

  // Counterparty info grid — broker doesn't have an id_number, so we
  // collapse to two cells (name + phone) instead of three when the
  // ID is missing. Same template, fewer columns.
  const showIdCell = !!counterparty.id_number;
  const gridCols = showIdCell ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';
  const idCellHtml = showIdCell ? `
        <div class="cell">
          <div class="label">رقم الهوية</div>
          <div class="value">${escapeHtml(counterparty.id_number || '-')}</div>
        </div>` : '';

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
  <title>${cfg.title} - ${escapeHtml(counterparty.full_name || '-')}</title>
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
    .invoice {
      max-width: 800px; margin: 0 auto;
      background: #ffffff; border: 1px solid ${accent};
      padding: 32px 34px;
    }
    .invoice-top {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 28px; padding-bottom: 20px;
      border-bottom: 1px solid ${accent}; margin-bottom: 24px;
    }
    .brand { max-width: 340px; }
    .brand .logo { max-height: 70px; max-width: 180px; margin-bottom: 10px; display: block; }
    .brand .name { font-size: 15px; font-weight: 700; }
    .brand .tax { font-size: 12px; margin-top: 2px; direction: ltr; text-align: right; font-weight: 500; }
    .brand .address { font-size: 12px; margin-top: 8px; line-height: 1.55; font-weight: 500; }
    .invoice-meta { text-align: left; min-width: 240px; }
    .invoice-meta .doc-title {
      font-size: 42px; font-weight: 800; letter-spacing: 0.5px;
      color: ${accent}; line-height: 1; margin-bottom: 4px;
    }
    .invoice-meta .subtitle { font-size: 12px; color: ${accent}; margin-bottom: 14px; }
    .meta-rows { width: 100%; border: 1px solid ${accent}; font-size: 12px; }
    .meta-rows .row { display: flex; }
    .meta-rows .row + .row { border-top: 1px solid ${accent}; }
    .meta-rows .label {
      flex: 0 0 130px; padding: 7px 12px;
      background: ${accentBg}; font-weight: 700; color: ${accent};
      font-size: 11.5px; text-align: right;
      border-left: 1px solid ${accent}; letter-spacing: 0.3px;
    }
    .meta-rows .val {
      flex: 1; padding: 7px 12px;
      text-align: left; direction: ltr;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .customer { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .section-title {
      padding: 8px 14px;
      border-bottom: 1px solid #1a1a1a;
      background: #f4f4f5;
      font-size: 11px; font-weight: 700;
      letter-spacing: 1.5px; text-transform: uppercase;
    }
    .customer-grid { display: grid; grid-template-columns: ${gridCols}; }
    .customer-grid .cell { padding: 9px 14px; }
    .customer-grid .cell + .cell { border-right: 1px solid #1a1a1a; }
    .customer-grid .label {
      font-size: 10px; font-weight: 700;
      letter-spacing: 0.3px; margin-bottom: 3px; opacity: 0.75;
    }
    .customer-grid .value { font-size: 13px; font-weight: 600; }

    .body-section { margin-bottom: 22px; border: 1px solid #1a1a1a; padding: 14px 16px; }
    .body-section .row { display: flex; padding: 6px 0; }
    .body-section .row + .row { border-top: 1px dashed #d4d4d8; }
    .body-section .label { flex: 0 0 140px; font-weight: 700; font-size: 12px; }
    .body-section .val { flex: 1; text-align: right; direction: rtl; font-weight: 500; color: #1a1a1a; }

    .lines-section { margin-bottom: 22px; border: 1px solid #1a1a1a; }
    .lines { width: 100%; border-collapse: collapse; font-size: 12px; }
    .lines thead th {
      background: ${accentBg}; color: ${accent};
      font-size: 11px; font-weight: 700;
      letter-spacing: 1px; text-transform: uppercase;
      padding: 9px 12px; text-align: right;
      border-bottom: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
    }
    .lines thead th:last-child { border-left: none; }
    .lines tbody td {
      padding: 10px 12px;
      border-top: 1px solid #1a1a1a;
      border-left: 1px solid #1a1a1a;
      font-size: 12px; color: #1a1a1a; font-weight: 500;
    }
    .lines tbody td:last-child { border-left: none; }
    .lines tbody tr:first-child td { border-top: none; }
    .lines td.line-amount {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700;
    }
    .lines td.notes {
      text-align: right; font-weight: 500; color: #1a1a1a;
      max-width: 200px; white-space: normal; word-break: break-word;
    }
    .lines td.date {
      text-align: right; font-weight: 500;
    }
    .lines td.date .date-label {
      font-size: 10px; color: #6b7280; font-weight: 600;
      margin-bottom: 2px; letter-spacing: 0.2px;
    }
    .lines td.date .date-value {
      direction: ltr; text-align: left;
      font-variant-numeric: tabular-nums; font-weight: 700; color: #1a1a1a;
    }
    .lines .cheque-bank-line {
      font-size: 10.5px; font-weight: 500; color: #6b7280; margin-top: 2px;
    }

    .total-row {
      display: flex; justify-content: flex-end;
      gap: 12px; margin-bottom: 20px;
    }
    .total-row .box {
      border: 1px solid ${accent};
      display: flex; align-items: stretch;
    }
    .total-row .box .label {
      padding: 14px 20px;
      background: ${accent}; color: #ffffff;
      font-size: 12px; font-weight: 700;
      letter-spacing: 1.2px; text-transform: uppercase;
      display: flex; align-items: center;
    }
    .total-row .box .val {
      padding: 14px 28px;
      font-size: 28px; font-weight: 800;
      color: ${accent};
      direction: ltr;
      font-variant-numeric: tabular-nums;
    }

    .footer {
      padding-top: 16px; border-top: 1px solid #1a1a1a;
      font-size: 12px; text-align: center;
    }
    .footer .thanks { font-weight: 700; margin-bottom: 6px; }
    .footer .contact { line-height: 1.8; }
    .footer .contact a { color: #1a1a1a; text-decoration: none; }
    .footer .issued { margin-top: 10px; opacity: 0.7; }

    .actions { margin-top: 18px; display: flex; gap: 10px; justify-content: center; }
    .actions button {
      padding: 10px 22px;
      background: ${accent}; color: #ffffff;
      border: none; font-family: inherit;
      font-size: 13px; font-weight: 700;
      cursor: pointer; letter-spacing: 0.5px;
    }
    .actions button:hover { opacity: 0.85; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="invoice-top">
      <div class="brand">
        ${branding.logoUrl ? `<img class="logo" src="${branding.logoUrl}" alt="${escapeHtml(branding.companyName)}" />` : ''}
        <div class="name">${escapeHtml(branding.companyName)}</div>
        ${(branding as any).taxNumber ? `<div class="tax">رقم المشغل: ${escapeHtml((branding as any).taxNumber)}</div>` : ''}
        ${(branding as any).invoiceAddress ? `<div class="address">${escapeHtml((branding as any).invoiceAddress)}</div>`
          : (companySettings.company_location ? `<div class="address">${escapeHtml(companySettings.company_location)}</div>` : '')}
      </div>
      <div class="invoice-meta">
        <div class="doc-title">${cfg.title}</div>
        <div class="subtitle">${cfg.subtitle}</div>
        <div class="meta-rows">
          <div class="row">
            <div class="label">${cfg.voucherNumberLabel}</div>
            <div class="val">${escapeHtml(voucher.voucher_number || '—')}</div>
          </div>
          ${source?.policy_document_number ? `
          <div class="row">
            <div class="label">يتعلق بمعاملة</div>
            <div class="val">${escapeHtml(source.policy_document_number)}</div>
          </div>
          ` : ''}
          ${source?.policy_number ? `
          <div class="row">
            <div class="label">رقم البوليصة</div>
            <div class="val">${escapeHtml(source.policy_number)}</div>
          </div>
          ` : ''}
          <div class="row">
            <div class="label">${cfg.defaultDateLabel}</div>
            <div class="val">${formatDate(voucher.settlement_date)}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="customer">
      <div class="section-title">${counterpartySectionTitle}</div>
      <div class="customer-grid">
        <div class="cell">
          <div class="label">${counterpartyNameLabel}</div>
          <div class="value">${escapeHtml(counterparty.full_name || '-')}</div>
        </div>
        ${idCellHtml}
        <div class="cell">
          <div class="label">${[counterparty.phone_number, counterparty.phone_number_2].filter(Boolean).length > 1 ? 'أرقام الهاتف' : 'رقم الهاتف'}</div>
          <div class="value">${escapeHtml(phoneDisplay)}</div>
        </div>
      </div>
    </div>

    <div class="lines-section">
      <div class="section-title">${cfg.detailsSectionTitle}</div>
      <table class="lines">
        <thead>
          <tr>
            <th style="width: 170px;">طريقة الدفع</th>
            <th style="width: 130px;">التاريخ</th>
            <th style="width: 110px;">المبلغ</th>
            ${anyNotes ? '<th>ملاحظات</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${linesHtml || `<tr><td colspan="${anyNotes ? 4 : 3}" style="text-align:center;color:#6b7280;padding:14px;">لا توجد تفاصيل</td></tr>`}
        </tbody>
      </table>
    </div>

    ${voucher.notes ? `
    <div class="body-section">
      <div class="row">
        <div class="label">ملاحظات</div>
        <div class="val">${escapeHtml(voucher.notes).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
    ` : ''}

    <div class="total-row">
      <div class="box">
        <div class="label">${cfg.totalLabel}</div>
        <div class="val">₪${Number(voucher.total_amount || 0).toLocaleString('en-US')}</div>
      </div>
    </div>

    <div class="footer">
      <div class="thanks">${cfg.thanksLine}</div>
      ${contactFooterHtml}
      <div class="issued">تاريخ الإصدار: ${formatDate(today.toISOString())}</div>
    </div>

    <div class="actions no-print">
      <button type="button" onclick="window.print()">طباعة</button>
    </div>
  </div>
</body>
</html>`;
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bunnyApiKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE');
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const agentId = await resolveAgentId(supabase, user.id);
    const branding = await getAgentBranding(supabase, agentId);

    const { voucher_receipt_id }: VoucherRequest = await req.json();
    if (!voucher_receipt_id) {
      return new Response(
        JSON.stringify({ error: "voucher_receipt_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Read the receipt row. The receipts table is the canonical
    // pivot for the voucher — every kind of source (policy_payments,
    // client_settlements, broker_settlements, manual entry) lands a
    // mirror row here.
    const { data: receiptRow, error: receiptErr } = await supabase
      .from('receipts')
      .select(`
        id, voucher_number, receipt_number, receipt_type, receipt_date,
        amount, payment_method, cheque_number, card_last_four, notes,
        client_id, client_name, broker_id, broker_settlement_id,
        policy_id, payment_id, client_settlement_id, created_at
      `)
      .eq('id', voucher_receipt_id)
      .maybeSingle();
    if (receiptErr || !receiptRow) {
      return new Response(
        JSON.stringify({ error: "voucher not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const receiptType = receiptRow.receipt_type as ReceiptType;
    const typeConfig = TYPE_CONFIGS[receiptType];
    if (!typeConfig) {
      return new Response(
        JSON.stringify({ error: `unknown receipt_type: ${receiptType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Resolve payment-line detail. Walk the source-FK ladder in
    // priority order. Each branch fills in `lines` with the
    // expanded breakdown (multi-method splits, customer cheque
    // expansion, etc.) and overrides `voucherNumber`/`voucherDate`/
    // `voucherNotes`/`voucherTotal` from the canonical source row.
    let lines: VoucherLine[] = [];
    let voucherTotal = Number(receiptRow.amount || 0);
    let voucherNumber = (receiptRow.voucher_number as string)
      || (receiptRow.receipt_number != null
        ? `R${receiptRow.receipt_number}/${new Date(receiptRow.receipt_date || receiptRow.created_at).getFullYear()}`
        : '—');
    let voucherDate = (receiptRow.receipt_date as string) || (receiptRow.created_at as string) || new Date().toISOString();
    let voucherNotes: string | null = (receiptRow.notes as string | null) ?? null;

    if (receiptRow.client_settlement_id) {
      // Client disbursement / credit_note path — same as the legacy
      // generate-disbursement-voucher logic.
      const { data: anchor } = await supabase
        .from('client_settlements')
        .select('settlement_session_id, settlement_date, notes, voucher_number')
        .eq('id', receiptRow.client_settlement_id)
        .maybeSingle();
      if (anchor) {
        voucherNumber = (anchor.voucher_number as string) || voucherNumber;
        voucherDate = (anchor.settlement_date as string) || voucherDate;
        voucherNotes = (anchor.notes as string | null) ?? voucherNotes;
        const filterCol = anchor.settlement_session_id ? 'settlement_session_id' : 'id';
        const filterVal = anchor.settlement_session_id ?? receiptRow.client_settlement_id;
        const { data: siblings } = await supabase
          .from('client_settlements')
          .select(`
            payment_type, cheque_number, cheque_due_date,
            cheque_issue_date, settlement_date, bank_code,
            branch_code, bank_reference, notes, total_amount,
            customer_cheque_ids
          `)
          .eq(filterCol, filterVal);
        const rows = (siblings ?? []) as any[];
        // Customer-cheque expansion (legacy parity).
        const allCustomerChequeIds: string[] = [];
        for (const r of rows) {
          if (r.payment_type === 'customer_cheque' && Array.isArray(r.customer_cheque_ids)) {
            allCustomerChequeIds.push(...r.customer_cheque_ids);
          }
        }
        const customerChequeMap = new Map<string, any>();
        if (allCustomerChequeIds.length > 0) {
          const { data: pp } = await supabase
            .from('policy_payments')
            .select('id, cheque_number, payment_date, bank_code, branch_code, amount')
            .in('id', allCustomerChequeIds);
          for (const c of (pp ?? []) as any[]) {
            customerChequeMap.set(c.id, c);
          }
        }
        voucherTotal = 0;
        for (const r of rows) {
          if (r.payment_type === 'customer_cheque' && Array.isArray(r.customer_cheque_ids)) {
            for (const cid of r.customer_cheque_ids) {
              const c = customerChequeMap.get(cid);
              if (!c) continue;
              const amt = Number(c.amount || 0);
              voucherTotal += amt;
              lines.push({
                payment_type: 'customer_cheque',
                cheque_number: c.cheque_number ?? null,
                cheque_due_date: c.payment_date ?? null,
                cheque_issue_date: null,
                payment_date: c.payment_date ?? null,
                bank_code: c.bank_code ?? null,
                branch_code: c.branch_code ?? null,
                bank_reference: null,
                notes: r.notes ?? null,
                amount: amt,
              });
            }
            continue;
          }
          const amt = Number(r.total_amount || 0);
          voucherTotal += amt;
          lines.push({
            payment_type: (r.payment_type as string) || 'cash',
            cheque_number: r.cheque_number ?? null,
            cheque_due_date: r.cheque_due_date ?? null,
            cheque_issue_date: r.cheque_issue_date ?? null,
            payment_date: r.settlement_date ?? null,
            bank_code: r.bank_code ?? null,
            branch_code: r.branch_code ?? null,
            bank_reference: r.bank_reference ?? null,
            notes: r.notes ?? null,
            amount: amt,
          });
        }
        if (voucherTotal === 0) voucherTotal = Number(receiptRow.amount || 0);
      }
    } else if (receiptRow.broker_settlement_id) {
      // Broker مرآة — the anchor is the first line we inserted in
      // persistSettlementLines. broker_settlements has no
      // session_id column, so siblings are found by (broker_id,
      // created_at window) instead. The receipts row was created
      // right after the settlement rows so anything inserted within
      // ~30 seconds of receipts.created_at is part of the same
      // physical save.
      const { data: anchor } = await supabase
        .from('broker_settlements')
        .select('id, broker_id, settlement_date, notes, created_at')
        .eq('id', receiptRow.broker_settlement_id)
        .maybeSingle();
      if (anchor) {
        voucherDate = (anchor.settlement_date as string) || voucherDate;
        voucherNotes = (anchor.notes as string | null) ?? voucherNotes;
        const anchorTime = new Date(anchor.created_at as string).getTime();
        const windowStart = new Date(anchorTime - 30_000).toISOString();
        const windowEnd = new Date(anchorTime + 30_000).toISOString();
        const { data: siblings } = await supabase
          .from('broker_settlements')
          .select(`
            payment_type, cheque_number, cheque_due_date,
            cheque_issue_date, settlement_date, bank_code,
            branch_code, bank_reference, notes, total_amount,
            created_at
          `)
          .eq('broker_id', anchor.broker_id)
          .gte('created_at', windowStart)
          .lte('created_at', windowEnd)
          .order('created_at', { ascending: true });
        voucherTotal = 0;
        for (const r of (siblings ?? []) as any[]) {
          const amt = Number(r.total_amount || 0);
          voucherTotal += amt;
          lines.push({
            payment_type: (r.payment_type as string) || 'cash',
            cheque_number: r.cheque_number ?? null,
            cheque_due_date: r.cheque_due_date ?? null,
            cheque_issue_date: r.cheque_issue_date ?? null,
            payment_date: r.settlement_date ?? null,
            bank_code: r.bank_code ?? null,
            branch_code: r.branch_code ?? null,
            bank_reference: r.bank_reference ?? null,
            notes: r.notes ?? null,
            amount: amt,
          });
        }
        if (voucherTotal === 0) voucherTotal = Number(receiptRow.amount || 0);
      }
    } else if (receiptRow.payment_id) {
      // Customer payment path — the legacy bulk-receipt source.
      // Pull the anchor + every payment in the same
      // payment_session_id / batch_id.
      const { data: anchorPayment } = await supabase
        .from('policy_payments')
        .select('payment_session_id, batch_id, payment_date, receipt_number, notes')
        .eq('id', receiptRow.payment_id)
        .maybeSingle();
      if (anchorPayment) {
        voucherDate = (anchorPayment.payment_date as string) || voucherDate;
        voucherNotes = (anchorPayment.notes as string | null) ?? voucherNotes;
        if (anchorPayment.receipt_number) {
          voucherNumber = String(anchorPayment.receipt_number);
        }
        const sessionId = anchorPayment.payment_session_id ?? anchorPayment.batch_id;
        const filterCol = sessionId ? (anchorPayment.payment_session_id ? 'payment_session_id' : 'batch_id') : 'id';
        const filterVal = sessionId ?? receiptRow.payment_id;
        const { data: siblings } = await supabase
          .from('policy_payments')
          .select(`
            payment_type, cheque_number, cheque_date, cheque_issue_date,
            payment_date, bank_code, branch_code, notes, amount, refused
          `)
          .eq(filterCol, filterVal);
        voucherTotal = 0;
        for (const r of (siblings ?? []) as any[]) {
          if (r.refused) continue;
          const amt = Number(r.amount || 0);
          voucherTotal += amt;
          lines.push({
            payment_type: (r.payment_type as string) || 'cash',
            cheque_number: r.cheque_number ?? null,
            cheque_due_date: r.cheque_date ?? null,
            cheque_issue_date: r.cheque_issue_date ?? null,
            payment_date: r.payment_date ?? null,
            bank_code: r.bank_code ?? null,
            branch_code: r.branch_code ?? null,
            bank_reference: null,
            notes: r.notes ?? null,
            amount: amt,
          });
        }
        if (voucherTotal === 0) voucherTotal = Number(receiptRow.amount || 0);
      }
    }

    // Fallback: no upstream source → render the receipt row itself
    // as a single line. Covers manual receipts and any future entry
    // path that writes directly to the receipts table.
    if (lines.length === 0) {
      const fallbackMethod = (receiptRow.payment_method as string) || 'cash';
      lines.push({
        payment_type: fallbackMethod,
        cheque_number: (receiptRow.cheque_number as string | null) ?? null,
        cheque_due_date: null,
        cheque_issue_date: null,
        payment_date: receiptRow.receipt_date as string | null,
        bank_code: null,
        branch_code: null,
        bank_reference: null,
        notes: voucherNotes,
        amount: Number(receiptRow.amount || 0),
      });
    }

    // 3. Resolve counterparty. client_id has priority (matches the
    // explicit data), then broker_id (broker mirror), then the
    // policy join (legacy receipts without client_id), then the
    // bare client_name string from the receipt row.
    let counterparty: Counterparty = {
      kind: 'manual',
      full_name: (receiptRow.client_name as string) || '-',
      id_number: null,
      phone_number: null,
      phone_number_2: null,
    };
    if (receiptRow.client_id) {
      const { data: c } = await supabase
        .from('clients')
        .select('full_name, id_number, phone_number, phone_number_2')
        .eq('id', receiptRow.client_id)
        .maybeSingle();
      if (c) {
        counterparty = {
          kind: 'client',
          full_name: c.full_name || (receiptRow.client_name as string) || '-',
          id_number: c.id_number ?? null,
          phone_number: c.phone_number ?? null,
          phone_number_2: c.phone_number_2 ?? null,
        };
      }
    } else if (receiptRow.broker_id) {
      const { data: b } = await supabase
        .from('brokers')
        .select('name, phone')
        .eq('id', receiptRow.broker_id)
        .maybeSingle();
      if (b) {
        counterparty = {
          kind: 'broker',
          full_name: (b.name as string) || (receiptRow.client_name as string) || '-',
          id_number: null,
          phone_number: (b.phone as string | null) ?? null,
          phone_number_2: null,
        };
      }
    } else if (receiptRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('client:clients(full_name, id_number, phone_number, phone_number_2)')
        .eq('id', receiptRow.policy_id)
        .maybeSingle();
      const cr = Array.isArray((pol as any)?.client) ? (pol as any).client[0] : (pol as any)?.client;
      if (cr) {
        counterparty = {
          kind: 'client',
          full_name: cr.full_name || '-',
          id_number: cr.id_number ?? null,
          phone_number: cr.phone_number ?? null,
          phone_number_2: cr.phone_number_2 ?? null,
        };
      }
    }

    // 4. Policy meta — only fetched when the voucher is tied to one.
    let source: { policy_document_number: string | null; policy_number: string | null } | null = null;
    if (receiptRow.policy_id) {
      const { data: pol } = await supabase
        .from('policies')
        .select('document_number, policy_number')
        .eq('id', receiptRow.policy_id)
        .maybeSingle();
      if (pol) {
        source = {
          policy_document_number: (pol as any).document_number ?? null,
          policy_number: (pol as any).policy_number ?? null,
        };
      }
    }

    // 5. Footer / contact info — shared agency SMS settings.
    const { data: smsSettings } = await supabase
      .from('sms_settings')
      .select('company_email, company_phone_links, company_location')
      .limit(1)
      .maybeSingle();
    const companySettings = {
      company_email: smsSettings?.company_email || '',
      company_phone_links: (smsSettings?.company_phone_links as PhoneLink[]) || [],
      company_location: smsSettings?.company_location || '',
    };

    // 6. Render + upload.
    const html = buildHtml(
      typeConfig,
      {
        voucher_number: voucherNumber,
        settlement_date: voucherDate,
        total_amount: voucherTotal,
        notes: voucherNotes,
      },
      lines,
      source,
      counterparty,
      companySettings,
      branding,
    );

    if (!bunnyApiKey || !bunnyStorageZone) {
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = Date.now();
    const randomId = crypto.randomUUID().slice(0, 8);
    const nameSafe = (counterparty.full_name || 'voucher')
      .replace(/[^a-zA-Z0-9؀-ۿ]/g, '_')
      .slice(0, 40);
    const storagePath = `vouchers/${year}/${month}/${typeConfig.fileSlugPrefix}_${nameSafe}_${timestamp}_${randomId}.html`;
    const bunnyUploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    const uploadResponse = await fetch(bunnyUploadUrl, {
      method: 'PUT',
      headers: {
        'AccessKey': bunnyApiKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });
    if (!uploadResponse.ok) {
      console.error('[generate-voucher] Bunny upload failed', uploadResponse.status);
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const receiptUrl = `${bunnyCdnUrl}/${storagePath}`;
    return new Response(
      JSON.stringify({ success: true, receipt_url: receiptUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("[generate-voucher] Fatal:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

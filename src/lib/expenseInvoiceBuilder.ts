/**
 * Builds a Hebrew invoice HTML for expense vouchers (קבלה / חשבונית זיכוי)
 * Styled to match the Rivhit-style receipt format (RTL)
 */

interface ExpenseRow {
  description: string | null;
  amount: number;
  expense_date: string;
  category: string;
  contact_name: string | null;
  payment_method: string;
  reference_number: string | null;
}

const categoryLabelsHe: Record<string, string> = {
  rent: 'שכירות משרד',
  salaries: 'משכורות',
  food: 'אוכל למשרד',
  utilities: 'חשבונות (חשמל/מים/אינטרנט)',
  insurance_company: 'תשלום לחברת ביטוח',
  insurance_company_due: 'חוב לחברת ביטוח',
  other: 'הוצאות אחרות',
  insurance_premium: 'פרמיית ביטוח',
  commission: 'עמלה',
  elzami_office_commission: 'עמלת משרד חובה',
  debt_collection: 'גביית חוב',
  other_income: 'הכנסות אחרות',
};

const paymentMethodLabelsHe: Record<string, string> = {
  cash: 'מזומן',
  cheque: 'שיק',
  bank_transfer: 'העברה בנקאית',
  visa: 'ויזה',
};

export function buildExpenseInvoiceHtml(
  rows: ExpenseRow[],
  type: 'receipt' | 'payment',
  monthLabel: string,
  logoUrl: string | null,
  businessName: string,
): string {
  const title = type === 'receipt' ? 'קבלה' : 'חשבונית זיכוי';
  const today = new Date().toLocaleDateString('en-GB');

  // Exclude company dues
  const filtered = rows.filter((r: any) => !r.is_company_due);

  const total = filtered.reduce((sum, r) => sum + r.amount, 0);
  const totalFormatted = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const invoiceNumber = '01';

  const tableRows = filtered.map((r, i) => {
    const cat = categoryLabelsHe[r.category] || r.category;
    const pm = paymentMethodLabelsHe[r.payment_method] || r.payment_method;
    const date = new Date(r.expense_date).toLocaleDateString('en-GB');
    const amt = r.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${i + 1}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.description || '-'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${cat}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.contact_name || '-'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${pm}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${date}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:left;font-weight:600;">₪${amt}</td>
      </tr>`;
  }).join('');

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Logo" style="max-height:70px;object-fit:contain;" />`
    : '';

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Arial', 'Tahoma', 'Noto Sans Hebrew', sans-serif;
      direction: rtl;
      color: #1f2937;
      background: #fff;
      padding: 30px 40px;
      font-size: 13px;
    }
    .header-box {
      border: 3px solid #1e3a5f;
      border-radius: 8px;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .header-right {
      text-align: right;
    }
    .header-right .biz-name {
      font-size: 22px;
      font-weight: 700;
      color: #1e3a5f;
      margin-bottom: 2px;
    }
    .header-right .biz-details {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.6;
    }
    .header-center {
      text-align: center;
    }
    .header-left {
      text-align: left;
      font-size: 13px;
      color: #374151;
      font-weight: 600;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding: 8px 0;
      border-bottom: 2px solid #1e3a5f;
    }
    .title-row .doc-title {
      font-size: 26px;
      font-weight: 700;
      color: #1e3a5f;
    }
    .title-row .doc-number {
      font-size: 14px;
      color: #374151;
      font-weight: 600;
    }
    .title-row .doc-copy {
      font-size: 13px;
      color: #6b7280;
      font-weight: 600;
    }
    .info-section {
      display: flex;
      justify-content: space-between;
      margin-bottom: 16px;
      gap: 16px;
    }
    .info-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .info-box .label {
      font-size: 11px;
      color: #94a3b8;
      margin-bottom: 2px;
    }
    .info-box .value {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    thead th {
      background: #1e3a5f;
      color: #fff;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 600;
      text-align: right;
    }
    thead th:first-child { border-radius: 0 6px 0 0; text-align: center; }
    thead th:last-child { border-radius: 6px 0 0 0; text-align: left; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    .summary-box {
      display: flex;
      justify-content: flex-start;
      margin-top: 10px;
    }
    .summary-inner {
      background: linear-gradient(135deg, #1e3a5f, #2d5a8e);
      color: #fff;
      border-radius: 10px;
      padding: 16px 32px;
      text-align: center;
      min-width: 220px;
    }
    .summary-inner .total-label {
      font-size: 12px;
      opacity: 0.85;
      margin-bottom: 4px;
    }
    .summary-inner .total-value {
      font-size: 26px;
      font-weight: 700;
    }
    .footer {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      text-align: center;
      font-size: 11px;
      color: #9ca3af;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <!-- Header box matching Rivhit style -->
  <div class="header-box">
    <div class="header-right">
      <div class="biz-name">בשיר אבו סנינה</div>
      <div class="biz-details">
        בית חנינא חדשה, ירושלים<br/>
        טלפון: 026307377
      </div>
    </div>
    <div class="header-center">
      ${logoHtml}
    </div>
    <div class="header-left">
      עוסק מורשה 212426498
    </div>
  </div>

  <!-- Title row -->
  <div class="title-row">
    <div class="doc-title">${title}</div>
    <div class="doc-number">מספר חשבונית: ${invoiceNumber}</div>
    <div class="doc-copy">העתק</div>
  </div>

  <div class="info-section">
    <div class="info-box">
      <div class="label">תאריך הפקה</div>
      <div class="value">${today}</div>
    </div>
    <div class="info-box">
      <div class="label">תקופה</div>
      <div class="value">${monthLabel}</div>
    </div>
    <div class="info-box">
      <div class="label">מספר שורות</div>
      <div class="value">${filtered.length}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:center;">שורה</th>
        <th>פרטים</th>
        <th>קטגוריה</th>
        <th>גורם</th>
        <th>אמצעי תשלום</th>
        <th style="text-align:center;">תאריך</th>
        <th style="text-align:left;">סכום ₪</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="summary-box">
    <div class="summary-inner">
      <div class="total-label">סה"כ</div>
      <div class="total-value">₪${totalFormatted}</div>
    </div>
  </div>

  <div class="footer">
    ${businessName} &bull; מסמך זה הופק אוטומטית
  </div>
</body>
</html>`;
}

export function openExpenseInvoicePrint(html: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('אנא אפשרו חלונות קופצים / Please allow popups');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();

  printWindow.onafterprint = () => {
    printWindow.close();
  };
  printWindow.onload = () => {
    setTimeout(() => printWindow.print(), 400);
  };
}

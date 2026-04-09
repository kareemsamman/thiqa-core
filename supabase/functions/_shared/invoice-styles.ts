/**
 * Shared invoice/report styling constants.
 * All invoices use the same dark background (#122143) with a white card.
 */

/** Primary brand color for all invoice headers, backgrounds, accents */
export const INVOICE_BG = "#122143";

/** Lighter shade for gradients */
export const INVOICE_BG_LIGHT = "#1a3260";

/**
 * Returns the base CSS that wraps every invoice/report in the brand style:
 *  - Dark #122143 full-page background
 *  - White card with border-radius + shadow
 *  - Header gradient using the brand color
 *  - Tajawal font
 */
export function invoiceBaseStyles(opts?: { maxWidth?: string; printBg?: boolean }): string {
  const maxW = opts?.maxWidth || "800px";
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4; margin: 10mm; }
    body {
      font-family: 'Tajawal', 'Segoe UI', Tahoma, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.7;
      color: #2d3748;
      background: ${INVOICE_BG};
      min-height: 100vh;
      padding: 24px 16px;
      direction: rtl;
    }
    .container {
      max-width: ${maxW};
      margin: 0 auto;
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .header {
      text-align: center;
      padding: 30px 25px;
      background: linear-gradient(135deg, ${INVOICE_BG} 0%, ${INVOICE_BG_LIGHT} 100%);
      color: white;
    }
    .header h1 {
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .header .english-name {
      font-size: 14px;
      letter-spacing: 2px;
      opacity: 0.8;
      margin-bottom: 10px;
    }
    .header p { color: rgba(255,255,255,0.85); font-size: 14px; }
    .footer {
      text-align: center;
      padding: 20px;
      background: #f8fafc;
      color: #718096;
      font-size: 12px;
      border-top: 1px solid #e2e8f0;
    }
    .footer .thank-you {
      font-size: 16px;
      font-weight: 700;
      color: ${INVOICE_BG};
      margin-bottom: 12px;
    }
    .contact-info {
      margin: 15px 0;
      padding: 12px;
      background: #f1f5f9;
      border-radius: 8px;
      display: inline-block;
      text-align: center;
    }
    .contact-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 4px 0;
      color: ${INVOICE_BG};
      font-size: 12px;
    }
    .contact-row a { color: #2563eb; text-decoration: none; }
    .contact-row a:hover { text-decoration: underline; }
    @media print {
      body { background: white !important; padding: 0; }
      .container { box-shadow: none; border-radius: 0; }
      .no-print { display: none !important; }
    }
  `;
}

/**
 * Wrap a style block with the shared Tajawal font link.
 */
export function invoiceHead(title: string, extraStyles: string = ""): string {
  return `
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
<title>${title}</title>
<style>
  ${invoiceBaseStyles()}
  ${extraStyles}
</style>`;
}

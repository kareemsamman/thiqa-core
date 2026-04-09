/**
 * Shared Thiqa email template – modern, clean, email-client safe.
 * All emails sent from the platform should use this wrapper.
 */

const EMAIL_LOGO_URL = "https://kareem.b-cdn.net/logolight.png";

export interface EmailTemplateOptions {
  /** Main content HTML (goes inside the white card) */
  body: string;
  /** Optional footer text below the card */
  footerText?: string;
  /** Year for copyright - defaults to current year */
  year?: number;
}

/**
 * Wraps content in the Thiqa branded email template.
 * - Clean gradient background (CSS only, no image dependency)
 * - Centered white card with rounded corners
 * - Thiqa logo header
 * - RTL Arabic layout
 */
export function buildEmailHtml(options: EmailTemplateOptions): string {
  const { body, footerText, year = new Date().getFullYear() } = options;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;background-color:#0f0f1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0f0f1a;">
    <tr>
      <td align="center" style="padding:40px 16px 32px;">

        <!-- Logo -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <img src="${EMAIL_LOGO_URL}" alt="Thiqa" width="160" style="display:block;margin:0 auto;height:auto;max-width:160px;" />
            </td>
          </tr>
        </table>

        <!-- White Card -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:40px 36px 44px;font-family:'Segoe UI','Cairo',Arial,sans-serif;direction:rtl;text-align:center;">
              ${body}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;">
          <tr>
            <td align="center" style="padding:24px 16px 0;">
              ${footerText ? `<p style="margin:0 0 8px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:rgba(255,255,255,0.45);line-height:1.6;">${footerText}</p>` : ''}
              <p style="margin:0;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:rgba(255,255,255,0.25);">&copy; ${year} Thiqa Insurance Platform</p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** OTP code email body */
export function otpEmailBody(otp: string): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">رمز التحقق</h2>
    <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.7;">أدخل الرمز التالي لإتمام عملية تسجيل الدخول:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr><td style="background:#0f0f1a;color:#ffffff;border-radius:12px;padding:14px 36px;font-size:34px;font-weight:800;letter-spacing:14px;font-family:monospace,'Courier New',Courier;">${otp}</td></tr>
    </table>
    <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.6;">هذا الرمز صالح لمدة 5 دقائق فقط.</p>
  `;
}

/** Registration OTP email body */
export function registrationOtpEmailBody(otp: string): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">تأكيد البريد الإلكتروني</h2>
    <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.7;">أدخل الرمز التالي لتأكيد بريدك الإلكتروني:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr><td style="background:#0f0f1a;color:#ffffff;border-radius:12px;padding:14px 36px;font-size:34px;font-weight:800;letter-spacing:14px;font-family:monospace,'Courier New',Courier;">${otp}</td></tr>
    </table>
    <p style="margin:24px 0 0;color:#999;font-size:13px;line-height:1.6;">هذا الرمز صالح لمدة 5 دقائق فقط.</p>
  `;
}

/** Password reset email body */
export function passwordResetEmailBody(recoveryLink: string): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">إعادة تعيين كلمة المرور</h2>
    <p style="margin:0 0 28px;color:#666;font-size:15px;line-height:1.7;">
      لقد طلبت إعادة تعيين كلمة المرور الخاصة بك.<br/>
      اضغط على الزر أدناه لاختيار كلمة مرور جديدة:
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
      <tr><td>
        <a href="${recoveryLink}" target="_blank" style="display:inline-block;background:#0f0f1a;color:#ffffff;text-decoration:none;padding:14px 44px;border-radius:10px;font-size:16px;font-weight:600;font-family:'Segoe UI',Arial,sans-serif;">
          إعادة تعيين كلمة المرور
        </a>
      </td></tr>
    </table>
    <p style="margin:28px 0 0;color:#999;font-size:13px;line-height:1.6;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
  `;
}

/** SMTP test email body */
export function smtpTestEmailBody(smtpHost: string, smtpPort: number): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">اختبار SMTP ناجح!</h2>
    <p style="margin:0 0 8px;color:#333;font-size:16px;line-height:1.7;">تم إرسال هذه الرسالة بنجاح من منصة <strong>ثقة للتأمين</strong>.</p>
    <p style="margin:0 0 24px;color:#333;font-size:16px;">إعدادات البريد الإلكتروني تعمل بشكل صحيح! ✉️</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="border-top:1px solid #eee;padding-top:16px;">
        <p style="margin:0;color:#999;font-size:12px;direction:ltr;text-align:center;">SMTP Host: ${smtpHost}<br/>SMTP Port: ${smtpPort}</p>
      </td></tr>
    </table>
  `;
}

/** Welcome email body for new agents */
export function welcomeAgentEmailBody(agentName: string): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">مرحباً بك في ثقة! 🎉</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.8;">
      أهلاً <strong>${agentName}</strong>،<br/>
      تم إنشاء حسابك بنجاح على منصة <strong>ثقة للتأمين</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;max-width:380px;">
      <tr>
        <td style="background:#f8f9fa;border-radius:10px;padding:20px 24px;text-align:right;">
          <p style="margin:0 0 10px;color:#333;font-size:14px;line-height:1.8;">✅ إدارة العملاء والوثائق</p>
          <p style="margin:0 0 10px;color:#333;font-size:14px;line-height:1.8;">✅ حساب الأسعار والأرباح تلقائياً</p>
          <p style="margin:0 0 10px;color:#333;font-size:14px;line-height:1.8;">✅ تتبع المدفوعات والشيكات</p>
          <p style="margin:0;color:#333;font-size:14px;line-height:1.8;">✅ تقارير مالية شاملة</p>
        </td>
      </tr>
    </table>
    <p style="margin:28px 0 0;color:#999;font-size:13px;line-height:1.6;">يمكنك البدء فوراً بتسجيل الدخول إلى حسابك.</p>
  `;
}

/** Super admin notification: new agent registered */
export function newAgentAdminNotifyBody(agentName: string, agentEmail: string, agentPhone: string | null): string {
  return `
    <h2 style="margin:0 0 6px;color:#111;font-size:22px;font-weight:700;">وكيل جديد سجّل في المنصة 🆕</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.8;">تم تسجيل وكيل جديد على منصة ثقة للتأمين:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;max-width:400px;">
      <tr>
        <td style="background:#f8f9fa;border-radius:10px;padding:20px 24px;text-align:right;">
          <p style="margin:0 0 10px;color:#333;font-size:14px;line-height:1.8;"><strong>الاسم:</strong> ${agentName}</p>
          <p style="margin:0 0 10px;color:#333;font-size:14px;line-height:1.8;"><strong>البريد:</strong> ${agentEmail}</p>
          <p style="margin:0;color:#333;font-size:14px;line-height:1.8;"><strong>الهاتف:</strong> ${agentPhone || "غير متوفر"}</p>
        </td>
      </tr>
    </table>
    <p style="margin:28px 0 0;color:#999;font-size:13px;line-height:1.6;">يمكنك مراجعة الحساب من لوحة تحكم المنصة.</p>
  `;
}

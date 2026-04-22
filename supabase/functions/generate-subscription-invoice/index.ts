// Generates a branded PDF-ready HTML invoice for a single
// agent_subscription_payments row, uploads it to BunnyCDN, and stores
// the URL back on the row. Called from the Thiqa admin after a
// payment is recorded and idempotent if re-invoked (overwrites the
// file at the same fixed path).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.88.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

interface PaymentRow {
  id: string;
  agent_id: string;
  amount: number;
  plan: string;
  payment_date: string;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  name_ar: string | null;
  email: string;
  phone: string | null;
}

interface PlanRow {
  name: string;
  name_ar: string | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth check — this function does its own user resolution via
    // auth.getUser so the gateway's HS256 verifier can be bypassed
    // (verify_jwt = false in config.toml).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { payment_id } = await req.json();
    if (!payment_id) {
      return new Response(JSON.stringify({ error: 'payment_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch payment + agent + plan in parallel
    const { data: payment, error: paymentErr } = await supabase
      .from('agent_subscription_payments')
      .select('*')
      .eq('id', payment_id)
      .maybeSingle<PaymentRow>();
    if (paymentErr || !payment) {
      return new Response(JSON.stringify({ error: 'Payment not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [agentResp, planResp] = await Promise.all([
      supabase
        .from('agents')
        .select('id, name, name_ar, email, phone')
        .eq('id', payment.agent_id)
        .maybeSingle<AgentRow>(),
      supabase
        .from('subscription_plans')
        .select('name, name_ar')
        .eq('plan_key', payment.plan)
        .maybeSingle<PlanRow>(),
    ]);

    const agent = agentResp.data;
    const plan = planResp.data;
    if (!agent) {
      return new Response(JSON.stringify({ error: 'Agent not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const companyName = agent.name_ar || agent.name;
    const planName = plan?.name_ar || plan?.name || payment.plan;
    const receiptNumber = payment.id.slice(0, 8).toUpperCase();
    const period = payment.period_start && payment.period_end
      ? `${formatDate(payment.period_start)} — ${formatDate(payment.period_end)}`
      : '—';

    const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>إيصال اشتراك — ${escapeHtml(companyName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      background: #f1f5f9;
      padding: 24px;
      color: #0f172a;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: white;
      box-shadow: 0 4px 18px rgba(15,23,42,0.08);
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 40px 48px;
      border-bottom: 3px double #1e3a5f;
      text-align: center;
      background: linear-gradient(135deg, #f8fafc, #eef2ff);
    }
    .header h1 { font-size: 28px; color: #1e3a5f; letter-spacing: 0.5px; }
    .header p { font-size: 14px; color: #64748b; margin-top: 6px; }
    .receipt-banner {
      display: inline-block;
      margin-top: 18px;
      padding: 8px 20px;
      background: #1e3a5f;
      color: white;
      border-radius: 999px;
      font-size: 14px;
      letter-spacing: 1px;
    }
    .body { padding: 40px 48px; flex: 1; }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 32px;
    }
    .meta-cell {
      padding: 14px 16px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .meta-cell .label { font-size: 12px; color: #64748b; margin-bottom: 4px; }
    .meta-cell .value { font-size: 15px; font-weight: 600; color: #0f172a; }
    .amount-card {
      margin: 24px 0 32px;
      padding: 28px;
      background: linear-gradient(135deg, #1e3a5f, #334155);
      color: white;
      border-radius: 12px;
      text-align: center;
    }
    .amount-card .label { font-size: 14px; opacity: 0.85; margin-bottom: 8px; }
    .amount-card .amount { font-size: 44px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { text-align: right; padding: 12px 10px; border-bottom: 1px solid #e5e7eb; }
    th { background: #f1f5f9; font-size: 13px; color: #64748b; }
    td { font-size: 14px; }
    .footer {
      padding: 20px 48px;
      background: #f8fafc;
      border-top: 1px solid #e5e7eb;
      color: #64748b;
      font-size: 12px;
      text-align: center;
    }
    .notes {
      margin-top: 16px;
      padding: 14px 16px;
      background: #fffbeb;
      border-right: 3px solid #f59e0b;
      border-radius: 4px;
      font-size: 13px;
      color: #78350f;
    }
    @media print {
      @page { size: A4; margin: 12mm; }
      body { background: white; padding: 0; }
      .page { width: 100%; min-height: auto; box-shadow: none; border-radius: 0; }
      .header, .amount-card, .footer {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
  <script>
    if (window.location.search.includes('print=1')) {
      window.onload = function () { setTimeout(function () { window.print(); }, 500); };
    }
  </script>
</head>
<body>
  <div class="page">
    <div class="header">
      <h1>ثقة للتأمين</h1>
      <p>منصة إدارة وكلاء التأمين</p>
      <div class="receipt-banner">إيصال اشتراك رقم ${escapeHtml(receiptNumber)}</div>
    </div>

    <div class="body">
      <div class="meta-grid">
        <div class="meta-cell">
          <div class="label">الوكالة</div>
          <div class="value">${escapeHtml(companyName)}</div>
        </div>
        <div class="meta-cell">
          <div class="label">البريد الإلكتروني</div>
          <div class="value">${escapeHtml(agent.email || '—')}</div>
        </div>
        <div class="meta-cell">
          <div class="label">رقم الإيصال</div>
          <div class="value">${escapeHtml(receiptNumber)}</div>
        </div>
        <div class="meta-cell">
          <div class="label">تاريخ الدفع</div>
          <div class="value">${escapeHtml(formatDate(payment.payment_date))}</div>
        </div>
      </div>

      <div class="amount-card">
        <div class="label">المبلغ المدفوع</div>
        <div class="amount">₪${payment.amount.toLocaleString()}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>البيان</th>
            <th>الفترة</th>
            <th style="text-align:left">المبلغ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>اشتراك ${escapeHtml(planName)}</td>
            <td>${escapeHtml(period)}</td>
            <td style="text-align:left; font-weight:600;">₪${payment.amount.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      ${payment.notes ? `<div class="notes">${escapeHtml(payment.notes)}</div>` : ''}
    </div>

    <div class="footer">
      تم إصدار هذا الإيصال إلكترونياً من منصة ثقة — لا يتطلب توقيعاً ورقياً.
    </div>
  </div>
</body>
</html>`;

    // Upload to BunnyCDN at a stable path so re-invoking overwrites.
    const bunnyStorageKey = Deno.env.get('BUNNY_API_KEY');
    const bunnyAccountKey = Deno.env.get('BUNNY_ACCOUNT_API_KEY');
    const bunnyStorageZone = Deno.env.get('BUNNY_STORAGE_ZONE') || 'kareem';
    const bunnyCdnUrl = Deno.env.get('BUNNY_CDN_URL') || 'https://kareem.b-cdn.net';

    if (!bunnyStorageKey) {
      return new Response(JSON.stringify({ error: 'Storage not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const storagePath = `subscription-receipts/${payment.id}/invoice.html`;
    const uploadUrl = `https://storage.bunnycdn.com/${bunnyStorageZone}/${storagePath}`;
    const cdnBase = bunnyCdnUrl.startsWith('http') ? bunnyCdnUrl : `https://${bunnyCdnUrl}`;
    const cdnUrl = `${cdnBase}/${storagePath}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        AccessKey: bunnyStorageKey,
        'Content-Type': 'text/html; charset=utf-8',
      },
      body: html,
    });
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('Bunny upload failed:', errorText);
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    if (bunnyAccountKey) {
      try {
        await fetch(`https://api.bunny.net/purge?url=${encodeURIComponent(cdnUrl)}`, {
          method: 'POST',
          headers: { AccessKey: bunnyAccountKey },
        });
      } catch (err) {
        console.warn('Cache purge failed (non-fatal):', err);
      }
    }

    const urlWithCacheBuster = `${cdnUrl}?v=${Date.now()}`;
    await supabase
      .from('agent_subscription_payments')
      .update({ receipt_url: urlWithCacheBuster })
      .eq('id', payment.id);

    return new Response(JSON.stringify({ success: true, url: urlWithCacheBuster }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in generate-subscription-invoice:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
